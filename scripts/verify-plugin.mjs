#!/usr/bin/env node
/* eslint-env node */
// Mulby 插件验证 CLI（仓库内驱动）。
//
// 在「验证模式」下拉起 Mulby（隔离 userData），加载并冒烟测试单个插件，
// 解析 stdout 中的 JSON 报告并人类可读地打印，按结果设置退出码（0 通过 / 1 未通过）。
//
// 用法：
//   node scripts/verify-plugin.mjs <plugin-dir> [选项]
//   pnpm verify:plugin <plugin-dir> [选项]
//
// 选项：
//   --json              直接输出 JSON 报告（机器可读）
//   --strict            严格模式（warn 也判失败）
//   --build             找不到主进程构建产物时先执行 vite build
//   --app-path <exe>    指定 Mulby 可执行文件（默认用仓库内 electron + dist 产物）
//   --main <entry>      指定主进程入口（与 --app-path 搭配，用于 electron 场景）
//   --timeout <ms>      超时时间（默认 60000）
//
// 协议标记需与 src/shared/types/plugin-verify.ts 保持一致。
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const REPORT_BEGIN = '<<<MULBY_VERIFY_REPORT_BEGIN>>>'
const REPORT_END = '<<<MULBY_VERIFY_REPORT_END>>>'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
}
const useColor = process.stdout.isTTY
const paint = (color, s) => (useColor ? `${color}${s}${c.reset}` : s)
const SYMBOL = { pass: '✓', fail: '✗', warn: '⚠', skip: '·' }
const SYMBOL_COLOR = { pass: c.green, fail: c.red, warn: c.yellow, skip: c.gray }

function parseArgs(argv) {
  const args = { _: [], json: false, strict: false, build: false, keepUserData: false, timeout: 60000 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--strict') args.strict = true
    else if (a === '--build') args.build = true
    else if (a === '--keep-userdata') args.keepUserData = true
    else if (a === '--app-path') args.appPath = argv[++i]
    else if (a === '--main') args.main = argv[++i]
    else if (a === '--timeout') args.timeout = Number(argv[++i]) || args.timeout
    else if (!a.startsWith('--')) args._.push(a)
  }
  return args
}

function extractReport(text) {
  const begin = text.lastIndexOf(REPORT_BEGIN)
  const end = text.lastIndexOf(REPORT_END)
  if (begin === -1 || end === -1 || end < begin) return null
  const json = text.slice(begin + REPORT_BEGIN.length, end).trim()
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function printReport(report) {
  const p = report.plugin || {}
  console.log()
  console.log(paint(c.bold, `Mulby 插件验证 · ${p.displayName || p.name || p.id || '(unknown)'}`))
  if (p.path) {
    console.log(paint(c.gray, `  ${p.version ? 'v' + p.version + '  ·  ' : ''}${p.path}`))
  }
  console.log()
  for (const check of report.checks || []) {
    const sym = paint(SYMBOL_COLOR[check.status] || c.reset, SYMBOL[check.status] || '?')
    const detail = check.detail ? paint(c.gray, ` — ${check.detail}`) : ''
    console.log(`  ${sym} ${check.title}${detail}`)
  }
  if (report.errors && report.errors.length) {
    console.log()
    console.log(paint(c.red, '致命错误:'))
    for (const e of report.errors) console.log(paint(c.red, `  • ${e}`))
  }
  const errLogs = (report.logs || []).filter((l) => l.level === 'error')
  if (errLogs.length) {
    console.log()
    console.log(paint(c.yellow, '插件错误输出:'))
    for (const l of errLogs.slice(0, 20)) console.log(paint(c.gray, `  [${l.source}] ${l.text}`))
  }
  console.log()
  const verdict = report.ok ? paint(c.green, '✓ 通过') : paint(c.red, '✗ 未通过')
  console.log(`${paint(c.bold, '结果:')} ${verdict}  ${paint(c.gray, `(${report.durationMs}ms)`)}`)
  console.log()
}

function run(cmd, cmdArgs, cwd) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, cmdArgs, { cwd, stdio: 'inherit' })
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))))
    p.on('error', rej)
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args._.length === 0) {
    console.error(
      '用法: node scripts/verify-plugin.mjs <plugin-dir> [--json] [--strict] [--build] [--app-path <exe>] [--main <entry>] [--timeout <ms>]'
    )
    process.exit(2)
  }

  const pluginDir = isAbsolute(args._[0]) ? args._[0] : resolve(process.cwd(), args._[0])
  if (!existsSync(join(pluginDir, 'manifest.json'))) {
    console.error(paint(c.red, `未找到 manifest.json: ${pluginDir}`))
    process.exit(2)
  }

  // 解析启动方式
  let exe = args.appPath || process.env.MULBY_APP_PATH
  let spawnArgs = []

  if (!exe) {
    // 默认：仓库内 electron + 构建产物
    const builtMain = join(repoRoot, 'dist', 'main', 'index.js')
    if (!existsSync(builtMain)) {
      if (args.build) {
        console.error(paint(c.cyan, '未找到构建产物，先执行 vite build...'))
        await run(process.execPath, [join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], repoRoot)
      } else {
        console.error(paint(c.red, `未找到主进程构建产物: ${builtMain}`))
        console.error(
          paint(c.gray, '请先运行 `pnpm build:bundle`（或加 --build 自动构建），或用 --app-path 指定已安装的 Mulby 可执行文件。')
        )
        process.exit(2)
      }
    }
    const require = createRequire(import.meta.url)
    try {
      exe = require('electron')
    } catch {
      console.error(paint(c.red, '无法解析 electron 可执行文件，请用 --app-path 指定。'))
      process.exit(2)
    }
    spawnArgs = [builtMain]
  } else if (args.main) {
    spawnArgs = [args.main]
  }

  const child = spawn(exe, spawnArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      MULBY_VERIFY_PLUGIN: pluginDir,
      ...(args.strict ? { MULBY_VERIFY_STRICT: '1' } : {}),
      ...(args.keepUserData ? { MULBY_VERIFY_KEEP_USERDATA: '1' } : {})
    }
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => {
    stdout += d.toString()
  })
  child.stderr.on('data', (d) => {
    stderr += d.toString()
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    console.error(paint(c.red, `验证超时（${args.timeout}ms），强制结束。`))
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }, args.timeout)

  const code = await new Promise((res) => {
    child.on('exit', (codeVal) => res(codeVal))
    child.on('error', (err) => {
      console.error(paint(c.red, `无法启动 Mulby: ${err.message}`))
      res(1)
    })
  })
  clearTimeout(timer)

  const report = extractReport(stdout)
  if (!report) {
    console.error(paint(c.red, timedOut ? '验证超时，未取得报告。' : '未能从输出中解析验证报告。'))
    if (stderr.trim()) {
      console.error(paint(c.gray, stderr.trim().split('\n').slice(-20).join('\n')))
    }
    process.exit(typeof code === 'number' && code !== 0 ? code : 1)
  }

  // 兜底清理隔离的临时 userData 目录（子进程已退出，文件锁已释放；与进程内清理互补）
  if (report.meta && report.meta.userDataDir && !args.keepUserData) {
    try {
      rmSync(report.meta.userDataDir, { recursive: true, force: true })
    } catch {
      /* 进程内通常已清理；此处为兜底，忽略失败 */
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    printReport(report)
  }
  process.exit(report.ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
