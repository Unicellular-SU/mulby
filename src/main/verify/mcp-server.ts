import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { rmSync, writeFileSync } from 'fs'
import { app } from 'electron'
import log from 'electron-log'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Plugin } from '../../shared/types/plugin'
import type { PluginManager } from '../plugin'
import { ensureAutomationIpcHandlers } from './automation-ipc'
import { PluginUiRenderer } from './ui-render'
import { VERIFY_USER_DATA } from './verify-bootstrap'
import { closeDatabase } from '../db'

/**
 * 插件验证 / 自动化 MCP server（Tier 2 闭环）。
 *
 * 由环境变量 MULBY_VERIFY_MCP=1 触发，在隔离的 headless Mulby 中运行一个 MCP server，
 * 让 AI（Claude Code / Cursor 等）边改插件边驱动 Mulby 检查：
 * load_plugin / list_features / search / run / render_ui / screenshot / query_dom / get_logs。
 *
 * 传输：Streamable HTTP（与 Mulby 自身的 MCP server 一致）。Electron 主进程的 stdio 无法可靠承载
 * MCP 帧（主进程 stdin 不可读、stdout 有杂散输出），因此走本机 HTTP。每请求创建独立的
 * Transport + Server（无状态模式），会话状态保存在本闭包中共享。
 *
 * 启动后将实际地址写入 stderr（`MULBY_VERIFY_MCP_URL=...`）以及 MULBY_VERIFY_MCP_PORTFILE
 * 指定的文件，供启动方 / 测试读取。可用 MULBY_VERIFY_MCP_PORT 固定端口（默认随机）。
 */

interface LogRecord {
  ts: number
  source: string
  level: string
  text: string
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function textResult(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { content: [{ type: 'text', text }] }
}

function errorResult(message: string): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
} {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function pluginSummary(pluginManager: PluginManager, plugin: Plugin): Record<string, unknown> {
  const features = pluginManager.getFeatures(plugin.id).map((f) => ({
    code: f.code,
    explain: f.explain,
    mode: f.mode ?? 'default',
    triggers: (f.cmds ?? []).map((c) =>
      c.type === 'keyword' ? `keyword:${c.value}` : c.type === 'regex' ? `regex:${c.match}` : c.type
    )
  }))
  return {
    id: plugin.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    hasBackground: Boolean(plugin.manifest.main),
    hasUI: Boolean(plugin.manifest.ui),
    features
  }
}

const TOOLS = [
  {
    name: 'load_plugin',
    description: '加载并注册一个插件目录用于验证，返回插件信息与功能列表。后续工具作用于最近一次加载的插件。',
    inputSchema: {
      type: 'object',
      properties: { dir: { type: 'string', description: '插件目录的绝对路径（含 manifest.json）' } },
      required: ['dir']
    }
  },
  {
    name: 'list_features',
    description: '列出当前已加载插件的功能入口（含触发词）。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'search',
    description: '用一个查询串驱动 Mulby 搜索，返回命中的插件功能（验证触发词配置是否正确）。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索输入（如功能的关键词）' } },
      required: ['query']
    }
  },
  {
    name: 'run',
    description: '执行当前插件的某个功能。静默/后台功能直连 host 执行；UI 功能离屏渲染。返回结果与日志。',
    inputSchema: {
      type: 'object',
      properties: {
        featureCode: { type: 'string', description: '功能 code' },
        input: { type: 'string', description: '输入文本（可选）' }
      },
      required: ['featureCode']
    }
  },
  {
    name: 'render_ui',
    description: '离屏渲染当前插件的 UI，返回是否就绪、console 错误、加载/崩溃信息与页面概要。',
    inputSchema: {
      type: 'object',
      properties: {
        featureCode: { type: 'string', description: '功能 code（可选，缺省取第一个）' },
        route: { type: 'string', description: 'UI 路由 hash（可选）' }
      }
    }
  },
  {
    name: 'screenshot',
    description: '离屏渲染当前插件 UI 并截图，返回 PNG 图片。',
    inputSchema: {
      type: 'object',
      properties: {
        featureCode: { type: 'string', description: '功能 code（可选）' },
        route: { type: 'string', description: 'UI 路由 hash（可选）' }
      }
    }
  },
  {
    name: 'query_dom',
    description: '离屏渲染当前插件 UI 并查询 DOM：给 selector 返回匹配元素信息，或给 js 执行任意只读脚本。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector（与 js 二选一）' },
        js: { type: 'string', description: '自定义只读 JS 表达式（返回值需 JSON 可序列化）' },
        featureCode: { type: 'string', description: '功能 code（可选）' },
        route: { type: 'string', description: 'UI 路由 hash（可选）' }
      }
    }
  },
  {
    name: 'get_logs',
    description: '返回最近的 host 诊断日志（stdout/stderr/错误/退出）。',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '返回条数上限（默认 100）' } } }
  }
]

export async function runMcpVerifyServer(pluginManager: PluginManager): Promise<void> {
  const recentLogs: LogRecord[] = []
  const MAX_LOGS = 1000
  pluginManager.subscribeHostDiagnostics((evt) => {
    const rec: LogRecord =
      evt.kind === 'console'
        ? { ts: Date.now(), source: 'host', level: evt.level, text: evt.text }
        : evt.kind === 'error'
          ? { ts: Date.now(), source: 'host', level: 'error', text: evt.text }
          : { ts: Date.now(), source: 'host', level: evt.code === 0 ? 'info' : 'error', text: `host 退出码 ${evt.code}` }
    recentLogs.push(rec)
    if (recentLogs.length > MAX_LOGS) recentLogs.splice(0, recentLogs.length - MAX_LOGS)
  })

  // 注册插件 UI 挂载常用的 IPC 处理器（供 render/screenshot/query_dom 保真）
  ensureAutomationIpcHandlers(pluginManager)
  // 可复用的离屏渲染器（同一插件复用窗口，避免反复创建/销毁离屏窗口导致的卡死）
  const uiRenderer = new PluginUiRenderer()

  // ===== 会话状态（被每请求创建的 Server 共享）=====
  let current: Plugin | null = null
  const onLoaded = new Set<string>()
  const requireCurrent = (): Plugin => {
    if (!current) throw new Error('尚未加载插件，请先调用 load_plugin')
    return current
  }
  const pickFeatureCode = (plugin: Plugin, featureCode?: string): string => {
    if (featureCode) return featureCode
    return pluginManager.getFeatures(plugin.id)[0]?.code ?? ''
  }

  type ToolContent =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  const handleCall = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: ToolContent[]; isError?: boolean }> => {
    if (process.env.MULBY_VERIFY_MCP_DEBUG === '1') {
      try {
        process.stderr.write(`[mcp] tool ${name} ${JSON.stringify(args)}\n`)
      } catch {
        /* ignore */
      }
    }
    switch (name) {
      case 'load_plugin': {
        const dir = String(args.dir ?? '')
        if (!dir) return errorResult('缺少 dir')
        const plugin = await pluginManager.loadPluginForVerification(dir)
        if (!plugin) return errorResult(`加载失败：${dir}（manifest 非法或入口缺失）`)
        current = plugin
        onLoaded.delete(plugin.id)
        return textResult(pluginSummary(pluginManager, plugin))
      }
      case 'list_features': {
        const plugin = requireCurrent()
        return textResult(pluginSummary(pluginManager, plugin).features)
      }
      case 'search': {
        const results = await pluginManager.search(String(args.query ?? ''))
        return textResult(
          results.map((r) => ({ pluginId: r.plugin.id, featureCode: r.feature.code, matchType: r.matchType }))
        )
      }
      case 'run': {
        const plugin = requireCurrent()
        const featureCode = String(args.featureCode ?? '')
        if (!featureCode) return errorResult('缺少 featureCode')
        const feature = pluginManager.getFeatures(plugin.id).find((f) => f.code === featureCode)
        if (!feature) return errorResult(`未找到 feature：${featureCode}`)
        const inputText = typeof args.input === 'string' ? args.input : ''
        const isUi = Boolean(plugin.manifest.ui) && feature.mode !== 'silent'
        if (isUi) {
          const r = await uiRenderer.render(plugin, {
            featureCode,
            input: { text: inputText, attachments: [] },
            route: feature.route
          })
          return textResult({
            kind: 'ui',
            rendered: r.rendered,
            domReady: r.domReady,
            consoleErrors: r.consoleErrors,
            missingBridge: r.missingBridge.length,
            loadFailed: r.loadFailed,
            renderProcessGone: r.renderProcessGone,
            domSummary: r.domSummary
          })
        }
        if (plugin.manifest.main && !onLoaded.has(plugin.id)) {
          await pluginManager.verifyTriggerOnLoad(plugin)
          onLoaded.add(plugin.id)
        }
        const before = recentLogs.length
        await pluginManager.verifyRunFeature(plugin, featureCode, { text: inputText, attachments: [] })
        await delay(600)
        return textResult({ kind: 'silent', ok: true, logs: recentLogs.slice(before) })
      }
      case 'render_ui': {
        const plugin = requireCurrent()
        const r = await uiRenderer.render(plugin, {
          featureCode: pickFeatureCode(plugin, args.featureCode ? String(args.featureCode) : undefined),
          route: args.route ? String(args.route) : undefined
        })
        return textResult({
          rendered: r.rendered,
          domReady: r.domReady,
          consoleErrors: r.consoleErrors,
          missingBridge: r.missingBridge.length,
          loadFailed: r.loadFailed,
          renderProcessGone: r.renderProcessGone,
          domSummary: r.domSummary
        })
      }
      case 'screenshot': {
        const plugin = requireCurrent()
        const r = await uiRenderer.render(plugin, {
          featureCode: pickFeatureCode(plugin, args.featureCode ? String(args.featureCode) : undefined),
          route: args.route ? String(args.route) : undefined,
          wantScreenshot: true
        })
        if (!r.screenshotPng) {
          return errorResult(
            `截图失败：rendered=${r.rendered} loadFailed=${JSON.stringify(r.loadFailed)} crash=${JSON.stringify(r.renderProcessGone)}`
          )
        }
        return {
          content: [
            { type: 'text', text: `已渲染并截图（${r.screenshotPng.length} 字节）` },
            { type: 'image', data: r.screenshotPng.toString('base64'), mimeType: 'image/png' }
          ]
        }
      }
      case 'query_dom': {
        const plugin = requireCurrent()
        const selector = args.selector ? String(args.selector) : ''
        const js = args.js ? String(args.js) : ''
        if (!selector && !js) return errorResult('需要提供 selector 或 js')
        const domQueryJs = js
          ? js
          : `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? { found: true, tag: el.tagName, text: (el.textContent || '').slice(0, 1000), outerHTML: el.outerHTML.slice(0, 2000) } : { found: false }; })()`
        const r = await uiRenderer.render(plugin, {
          featureCode: pickFeatureCode(plugin, args.featureCode ? String(args.featureCode) : undefined),
          route: args.route ? String(args.route) : undefined,
          domQueryJs
        })
        return textResult({ rendered: r.rendered, consoleErrors: r.consoleErrors, result: r.domSummary })
      }
      case 'get_logs': {
        const limit = typeof args.limit === 'number' ? args.limit : 100
        return textResult(recentLogs.slice(-limit))
      }
      default:
        return errorResult(`未知工具：${name}`)
    }
  }

  const buildServer = (): Server => {
    const server = new Server({ name: 'mulby-plugin-verify', version: '0.1.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      try {
        return await handleCall(name, args)
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    })
    return server
  }

  // ===== Streamable HTTP 传输（每请求独立 Transport + Server，无状态）=====
  // 鉴权：设置 MULBY_VERIFY_MCP_TOKEN 则要求 Bearer；否则仅绑定 127.0.0.1 无鉴权（本机开发场景）。
  const token = process.env.MULBY_VERIFY_MCP_TOKEN || ''
  const host = '127.0.0.1'
  const port = Number(process.env.MULBY_VERIFY_MCP_PORT || 0)
  const httpServer = http.createServer((req, res) => {
    void (async () => {
      const url = req.url || '/'
      const method = (req.method || 'GET').toUpperCase()
      if (method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      if (url === '/health' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', service: 'mulby-plugin-verify' }))
        return
      }
      if (url === '/mcp' || url.startsWith('/mcp?')) {
        if (token) {
          const auth = req.headers.authorization || ''
          if (!auth.startsWith('Bearer ') || auth.slice(7).trim() !== token) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Unauthorized' }))
            return
          }
        }
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        let server: Server | null = null
        res.on('close', () => {
          void transport.close().catch(() => {})
          void server?.close().catch(() => {})
        })
        try {
          server = buildServer()
          await server.connect(transport)
          await transport.handleRequest(req, res)
        } catch (err) {
          log.error('[VerifyMcp] 请求处理失败:', err)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'internal error' }))
          }
        }
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
    })()
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => resolve())
  })

  const actualPort = (httpServer.address() as AddressInfo).port
  const urlStr = `http://${host}:${actualPort}/mcp`
  log.info(`[VerifyMcp] HTTP MCP server: ${urlStr}`)
  if (!token) {
    log.warn('[VerifyMcp] 未设置 MULBY_VERIFY_MCP_TOKEN：仅绑定 127.0.0.1 且无鉴权，本机其它进程可访问。生产/共享环境请设置该环境变量。')
  }
  try {
    process.stderr.write(`MULBY_VERIFY_MCP_URL=${urlStr}\n`)
  } catch {
    /* ignore */
  }
  if (process.env.MULBY_VERIFY_MCP_PORTFILE) {
    try {
      writeFileSync(
        process.env.MULBY_VERIFY_MCP_PORTFILE,
        JSON.stringify({ url: urlStr, userData: VERIFY_USER_DATA, token: token || null })
      )
    } catch (err) {
      log.warn('[VerifyMcp] 写 portfile 失败:', err)
    }
  }

  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    void (async () => {
      try {
        httpServer.close()
      } catch {
        /* ignore */
      }
      try {
        uiRenderer.destroy()
      } catch {
        /* ignore */
      }
      try {
        await pluginManager.destroy()
      } catch {
        /* ignore */
      }
      if (VERIFY_USER_DATA && process.env.MULBY_VERIFY_KEEP_USERDATA !== '1') {
        try {
          closeDatabase()
          rmSync(VERIFY_USER_DATA, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
      app.exit(0)
    })()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
