#!/usr/bin/env node
/* eslint-env node */
// 端到端测试 Mulby 插件验证 MCP server（Tier 2 闭环）。
//
// 拉起 `electron dist/main/index.js`（MULBY_VERIFY_MCP=1），等其把 MCP HTTP 地址写入
// portfile，再用 Streamable HTTP MCP 客户端依次调用工具验证：
// 静默插件 load/search/run、UI 插件 render_ui/query_dom/screenshot。
//
// 用法：pnpm build:bundle && node scripts/test-mcp-verify.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const require = createRequire(import.meta.url)

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败: ' + msg)
}
function firstText(res) {
  const c = (res.content || []).find((x) => x.type === 'text')
  return c ? c.text : ''
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForInfo(file, child, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) throw new Error('子进程提前退出，code=' + child.exitCode)
    if (existsSync(file)) {
      try {
        const info = JSON.parse(readFileSync(file, 'utf8'))
        if (info && typeof info.url === 'string' && info.url.startsWith('http')) return info
      } catch {
        /* 文件可能还在写，重试 */
      }
    }
    await sleep(200)
  }
  throw new Error('等待 MCP 地址超时')
}

async function main() {
  const builtMain = join(repoRoot, 'dist', 'main', 'index.js')
  assert(existsSync(builtMain), `未找到 ${builtMain}，请先运行 pnpm build:bundle`)
  const electronPath = require('electron')
  const portFile = join(tmpdir(), `mulby-mcp-url-${process.pid}.json`)
  try {
    rmSync(portFile, { force: true })
  } catch {
    /* ignore */
  }

  const child = spawn(electronPath, [builtMain], {
    cwd: repoRoot,
    env: { ...process.env, MULBY_VERIFY_MCP: '1', MULBY_VERIFY_MCP_PORTFILE: portFile },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', () => {}) // drain（避免子进程 stdout 写入阻塞 / Windows 同步错误）
  let childErr = ''
  child.stderr.on('data', (d) => {
    childErr += d.toString()
  })

  let client = null
  let isolatedUserData = null
  try {
    const info = await waitForInfo(portFile, child, 30000)
    isolatedUserData = info.userData
    const transport = new StreamableHTTPClientTransport(new URL(info.url))
    client = new Client({ name: 'mulby-verify-test', version: '0.1.0' })
    await client.connect(transport)

    const passed = []
    const tools = await client.listTools()
    const names = tools.tools.map((t) => t.name)
    for (const n of ['load_plugin', 'list_features', 'search', 'run', 'render_ui', 'screenshot', 'query_dom', 'get_logs']) {
      assert(names.includes(n), `缺少工具 ${n}`)
    }
    passed.push(`tools: ${names.join(', ')}`)

    // 静默插件
    const helloDir = join(repoRoot, 'test', 'fixtures', 'plugins', 'verify-hello')
    let r = await client.callTool({ name: 'load_plugin', arguments: { dir: helloDir } })
    assert(firstText(r).includes('com.mulby.verify-hello'), 'load_plugin verify-hello')
    r = await client.callTool({ name: 'search', arguments: { query: 'vhello' } })
    assert(firstText(r).includes('echo'), 'search 命中 echo')
    r = await client.callTool({ name: 'run', arguments: { featureCode: 'echo', input: 'vhello' } })
    assert(firstText(r).includes('"ok": true'), 'run echo ok')
    passed.push('silent plugin: load_plugin / search / run OK')

    // UI 插件
    const uiDir = join(repoRoot, 'test', 'fixtures', 'plugins', 'verify-hello-ui')
    r = await client.callTool({ name: 'load_plugin', arguments: { dir: uiDir } })
    assert(firstText(r).includes('com.mulby.verify-hello-ui'), 'load_plugin verify-hello-ui')
    r = await client.callTool({ name: 'render_ui', arguments: { featureCode: 'show' } })
    assert(firstText(r).includes('"rendered": true'), 'render_ui rendered=true')
    r = await client.callTool({ name: 'query_dom', arguments: { selector: '#status' } })
    assert(firstText(r).includes('mounted'), 'query_dom #status == mounted')
    r = await client.callTool({ name: 'screenshot', arguments: { featureCode: 'show' } })
    const img = (r.content || []).find((x) => x.type === 'image')
    assert(img && img.data && img.data.length > 100, 'screenshot 返回 PNG 图片')
    passed.push(`ui plugin: render_ui / query_dom / screenshot OK (png ${img.data.length} b64 chars)`)

    console.log('PASS')
    for (const line of passed) console.log('  - ' + line)
  } catch (err) {
    console.error('FAIL:', err.message)
    if (childErr) console.error('--- child stderr (tail) ---\n' + childErr.split('\n').slice(-25).join('\n'))
    process.exitCode = 1
  } finally {
    try {
      if (client) await client.close()
    } catch {
      /* ignore */
    }
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    await sleep(300)
    // 兜底清理隔离的临时 userData（子进程被杀后文件锁已释放）
    if (isolatedUserData) {
      try {
        rmSync(isolatedUserData, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(portFile, { force: true })
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exitCode = 1
})
