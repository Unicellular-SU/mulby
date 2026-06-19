import { app } from 'electron'
import log from 'electron-log'
import { rmSync } from 'fs'
import {
  VERIFY_REPORT_BEGIN,
  VERIFY_REPORT_END,
  VERIFY_REPORT_SCHEMA_VERSION,
  type VerifyReport
} from '../../shared/types/plugin-verify'
import { VERIFY_USER_DATA } from './verify-bootstrap'
import { closeDatabase } from '../db'
import type { PluginManager } from '../plugin'

export interface VerifyEntryOptions {
  strict?: boolean
}

/**
 * 验证模式入口：加载并校验目标插件，把报告打印到 stdout（包裹在标记之间），
 * 然后销毁 host 进程、关闭 SQLite、清理隔离的临时 userData 目录，
 * 最后以退出码 0（通过）/ 1（未通过）退出。
 *
 * 仅在主进程检测到 `MULBY_VERIFY_PLUGIN` 环境变量时由 index.ts 调用。
 */
export async function runVerifyModeAndExit(
  pluginManager: PluginManager,
  pluginDir: string,
  options: VerifyEntryOptions = {}
): Promise<void> {
  const strict = options.strict === true
  let report: VerifyReport

  try {
    const { runPluginVerification } = await import('./verify-runner')
    report = await runPluginVerification(pluginManager, pluginDir, {
      strict,
      userDataDir: VERIFY_USER_DATA ?? undefined
    })
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    log.error('[VerifyMode] 验证过程异常:', message)
    report = {
      schemaVersion: VERIFY_REPORT_SCHEMA_VERSION,
      ok: false,
      verdict: 'fail',
      plugin: { id: '', name: '', path: pluginDir, hasUI: false, hasBackground: false },
      checks: [],
      features: [],
      logs: [],
      errors: [message],
      durationMs: 0,
      meta: {
        platform: process.platform,
        electron: process.versions.electron,
        node: process.versions.node,
        timestamp: new Date().toISOString(),
        strict,
        userDataDir: VERIFY_USER_DATA ?? undefined
      }
    }
  }

  // 打印报告：用标记包裹单行 JSON，便于在日志噪声中稳定提取
  process.stdout.write(`\n${VERIFY_REPORT_BEGIN}\n${JSON.stringify(report)}\n${VERIFY_REPORT_END}\n`)

  const exitCode = report.ok ? 0 : 1

  // 清理：销毁 host / 搜索 worker
  try {
    await pluginManager.destroy()
  } catch (err) {
    log.warn('[VerifyMode] 销毁 PluginManager 出错:', err)
  }

  // 关闭 SQLite 并删除隔离的临时 userData 目录（释放文件锁后再删，避免 Windows EBUSY）。
  // MULBY_VERIFY_KEEP_USERDATA=1 时保留目录，便于排查。
  if (VERIFY_USER_DATA && process.env.MULBY_VERIFY_KEEP_USERDATA !== '1') {
    try {
      closeDatabase()
      rmSync(VERIFY_USER_DATA, { recursive: true, force: true })
    } catch (err) {
      log.warn('[VerifyMode] 清理临时 userData 出错:', err)
    }
  }

  // app.exit() 会跳过 before-quit 的异步清理；这在验证模式下是安全的：
  // 正常服务（剪贴板/托盘/热键等）从未启动，且上面已显式销毁 PluginManager 并清理资源。
  app.exit(exitCode)
}
