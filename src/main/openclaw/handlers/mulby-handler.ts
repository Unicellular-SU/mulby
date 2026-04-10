/**
 * Mulby 自定义命令处理器
 *
 * 核心差异化能力 — 让 OpenClaw Agent 远程调用 Mulby 插件生态：
 * - mulby.plugin.list:  列出已安装且已启用的插件
 * - mulby.plugin.tools: 列出所有插件注册的 AI Tools Schema（供 Gateway LLM 注册）
 * - mulby.plugin.invoke: 调用指定插件方法
 * - mulby.search: 综合搜索（插件 + 应用 + 文件）
 * - mulby.launch: 搜索并启动（应用/文件/插件）
 * - mulby.clipboard.get: 获取剪贴板内容
 * - mulby.clipboard.set: 设置剪贴板内容
 */

import { clipboard } from 'electron'
import type { CommandHandler } from '../command-registry'
import type { AiTool } from '../../../shared/types/ai'
import { parsePluginToolId, isPluginToolName } from '../../plugin/plugin-tools'
import { pluginShell } from '../../plugin/shell'

/** 插件搜索结果 */
interface PluginSearchResult {
  pluginId: string
  pluginName: string
  displayName: string
  featureCode: string
  featureExplain: string
  matchType: string
}

/** 判断插件匹配是否足够强（keyword/regex 精确匹配） */
function isStrongPluginMatch(matchType: string): boolean {
  return matchType === 'keyword' || matchType === 'regex'
}

/** 桌面搜索结果（应用或文件） */
interface DesktopResult {
  name: string
  path: string
  type?: string
}

/** 所需的外部依赖注入 */
export interface MulbyHandlerDeps {
  /** 获取所有已安装的插件列表 */
  getPluginList: () => Array<{
    id: string
    name: string
    description?: string
    version: string
    enabled: boolean
  }>

  /** 调用指定插件的方法 */
  invokePlugin: (pluginId: string, method: string, args: unknown[]) => Promise<unknown>

  /** 桌面应用搜索（可选） */
  searchDesktop?: (query: string, limit: number) => Promise<DesktopResult[]>

  /** 桌面文件搜索（可选） */
  searchFiles?: (query: string, limit: number) => Promise<DesktopResult[]>

  /** 插件搜索（可选，返回匹配的功能入口） */
  searchPlugins?: (query: string) => Promise<PluginSearchResult[]>

  /** 执行插件（可选，pluginId + featureCode + input） */
  runPlugin?: (pluginId: string, featureCode: string, input?: string) => Promise<{
    success: boolean
    hasUI?: boolean
    error?: string
  }>

  /** 获取所有插件注册的 AI Tools（可选，供 mulby.plugin.tools 命令使用） */
  getAiTools?: () => AiTool[]

  /** 将 sanitizedPluginId 还原为原始 pluginId（供 mulby.plugin.invoke 通过 toolId 调用时使用） */
  resolveOriginalPluginId?: (sanitizedId: string) => string | undefined

  /** 检查指定工具是否被用户禁用（格式 "pluginId:toolName"） */
  isToolDisabled?: (pluginId: string, toolName: string) => boolean
}

/**
 * 创建 Mulby 自定义命令处理器
 */
export function createMulbyHandlers(deps: MulbyHandlerDeps): Record<string, { handler: CommandHandler; cap: string; description: string }> {
  return {
    'mulby.plugin.list': {
      cap: 'mulby',
      description: '列出 Mulby 已安装且已启用的插件',
      handler: async () => {
        const plugins = deps.getPluginList()
        return {
          plugins: plugins
            .filter((p) => p.enabled)
            .map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description || '',
              version: p.version
            }))
        }
      }
    },

    'mulby.plugin.tools': {
      cap: 'mulby',
      description: '列出所有插件注册的 AI Tool Schema（供 Gateway/LLM 发现并注册工具能力）',
      handler: async () => {
        const tools = deps.getAiTools?.() ?? []
        return {
          count: tools.length,
          tools
        }
      }
    },

    'mulby.plugin.invoke': {
      cap: 'mulby',
      description: '调用指定的 Mulby 插件 AI Tool 接口。支持两种调用方式：1) toolId: 使用 mulby.plugin.tools 返回的 function.name（如 plugin_tool__qrcode-helper__generate_qrcode）+ args 对象；2) pluginId + method + args 数组',
      handler: async (params) => {
        let pluginId: string
        let method: string
        let args: unknown[]

        const toolId = String(params.toolId || '').trim()
        if (toolId) {
          // 方式一：通过 toolId 调用（直接对应 mulby.plugin.tools 返回的 name 字段）
          if (!isPluginToolName(toolId)) {
            throw new Error(`无效的 toolId 格式: ${toolId}，应以 'plugin_tool__' 开头`)
          }
          const { pluginId: sanitizedId, toolName } = parsePluginToolId(toolId)
          const resolvedId = deps.resolveOriginalPluginId?.(sanitizedId)
          if (!resolvedId) {
            throw new Error(`无法解析 toolId: ${toolId}，请确认该 Tool 已加载`)
          }
          pluginId = resolvedId
          method = toolName

          // 检查该工具是否被用户禁用
          if (deps.isToolDisabled?.(pluginId, method)) {
            throw new Error(`Plugin tool is disabled by user: ${pluginId}:${method}`)
          }

          // args 兼容 object（AI 通常传 key/value） 和 array 两种格式
          const rawArgs = params.args
          args = Array.isArray(rawArgs) ? rawArgs : (rawArgs && typeof rawArgs === 'object') ? [rawArgs] : []
        } else {
          // 方式二：显式传 pluginId + method（兼容旧用法）
          pluginId = String(params.pluginId || '').trim()
          if (!pluginId) throw new Error('pluginId 或 toolId 至少需要一个')

          method = String(params.method || '').trim()
          if (!method) throw new Error('method is required')

          // 检查该工具是否被用户禁用
          if (deps.isToolDisabled?.(pluginId, method)) {
            throw new Error(`Plugin tool is disabled by user: ${pluginId}:${method}`)
          }

          args = Array.isArray(params.args) ? params.args : []
        }

        const result = await deps.invokePlugin(pluginId, method, args)
        return result
      }
    },


    'mulby.search': {
      cap: 'mulby',
      description: '综合搜索（插件功能 + 桌面应用 + 文件）',
      handler: async (params) => {
        const query = String(params.query || '').trim()
        if (!query) throw new Error('query is required')
        const limit = typeof params.limit === 'number' ? params.limit : 20

        // 并行搜索插件、桌面应用和文件
        const [pluginResults, appResults, fileResults] = await Promise.all([
          deps.searchPlugins?.(query).catch(() => [] as PluginSearchResult[]) ?? [],
          deps.searchDesktop?.(query, limit).catch(() => [] as DesktopResult[]) ?? [],
          deps.searchFiles?.(query, limit).catch(() => [] as DesktopResult[]) ?? []
        ])

        // [P2 Fix] 各类结果各自截取配额后合并，避免某一类占满 limit 导致其它类被截断
        const pluginQuota = Math.ceil(limit / 2)
        const desktopQuota = limit

        const results: Array<{
          type: 'plugin' | 'application' | 'file' | string
          name: string
          explain?: string
          pluginId?: string
          featureCode?: string
          path?: string
          matchType?: string
        }> = []

        // 插件结果（限额 pluginQuota）
        for (const p of pluginResults.slice(0, pluginQuota)) {
          results.push({
            type: 'plugin',
            name: p.displayName,
            explain: p.featureExplain,
            pluginId: p.pluginId,
            featureCode: p.featureCode,
            matchType: p.matchType
          })
        }

        // 桌面应用结果
        const desktopCombined: typeof results = []
        for (const a of appResults) {
          desktopCombined.push({
            type: a.type || 'application',
            name: a.name,
            path: a.path
          })
        }
        // 文件结果（排除 .app，避免与应用重复）
        for (const f of fileResults) {
          if (f.path.toLowerCase().endsWith('.app')) continue
          desktopCombined.push({
            type: 'file',
            name: f.name,
            path: f.path
          })
        }

        results.push(...desktopCombined.slice(0, desktopQuota))

        return {
          query,
          results: results.slice(0, limit)
        }
      }
    },

    'mulby.clipboard.get': {
      cap: 'mulby.clipboard',
      description: '获取 Mulby 所在机器的剪贴板内容',
      handler: async () => {
        const text = clipboard.readText()
        const html = clipboard.readHTML()
        return {
          text: text || '',
          html: html || '',
          hasImage: !clipboard.readImage().isEmpty()
        }
      }
    },

    'mulby.clipboard.set': {
      cap: 'mulby.clipboard',
      description: '设置 Mulby 所在机器的剪贴板内容',
      handler: async (params) => {
        const text = String(params.text || '')
        if (!text) throw new Error('text is required')
        clipboard.writeText(text)
        return { ok: true }
      }
    },

    'mulby.launch': {
      cap: 'mulby',
      description: '搜索并启动（支持应用、文件、插件功能）',
      handler: async (params) => {
        const query = String(params.query || '').trim()
        if (!query) throw new Error('query is required')

        // 并行搜索插件、桌面应用和文件
        const [pluginResults, appResults, fileResults] = await Promise.all([
          deps.searchPlugins?.(query).catch(() => [] as PluginSearchResult[]) ?? [],
          deps.searchDesktop?.(query, 5).catch(() => [] as DesktopResult[]) ?? [],
          deps.searchFiles?.(query, 5).catch(() => [] as DesktopResult[]) ?? []
        ])

        const bestPlugin = pluginResults[0]
        // 合并应用和文件结果
        const bestDesktop = appResults[0] || fileResults[0]

        if (!bestPlugin && !bestDesktop) {
          return { ok: false, message: `未找到匹配 "${query}" 的结果` }
        }

        // [P1 Fix] 仅当插件是 keyword/regex 精确匹配时才优先启动插件
        // 如果桌面应用/文件名与查询完全一致，优先选桌面结果（"微信" → WeChat.app）
        const shouldLaunchPlugin =
          bestPlugin &&
          deps.runPlugin &&
          isStrongPluginMatch(bestPlugin.matchType) &&
          !(bestDesktop && bestDesktop.name.toLowerCase() === query.toLowerCase())

        if (shouldLaunchPlugin && bestPlugin && deps.runPlugin) {
          const input = typeof params.input === 'string' ? params.input : undefined
          const result = await deps.runPlugin(bestPlugin.pluginId, bestPlugin.featureCode, input)
          return {
            ok: result.success,
            type: 'plugin',
            launched: {
              pluginId: bestPlugin.pluginId,
              name: bestPlugin.displayName,
              featureCode: bestPlugin.featureCode,
              explain: bestPlugin.featureExplain
            },
            error: result.error || null
          }
        }

        // 打开应用/文件
        if (bestDesktop) {
          try {
            const openError = await pluginShell.openPath(bestDesktop.path)
            if (openError) {
              return { ok: false, type: bestDesktop.type || 'application', error: openError }
            }
          } catch (err) {
            return { ok: false, type: bestDesktop.type || 'application', error: String(err) }
          }
          return {
            ok: true,
            type: bestDesktop.type || 'application',
            launched: {
              name: bestDesktop.name,
              path: bestDesktop.path
            }
          }
        }

        // 回退：有插件但没有 runPlugin 能力
        if (bestPlugin) {
          return {
            ok: false,
            type: 'plugin',
            message: `匹配到插件 "${bestPlugin.displayName}" 但无法自动执行，请使用 mulby.plugin.invoke 手动调用`,
            match: {
              pluginId: bestPlugin.pluginId,
              featureCode: bestPlugin.featureCode
            }
          }
        }

        return { ok: false, message: '没有可执行的匹配结果' }
      }
    }
  }
}
