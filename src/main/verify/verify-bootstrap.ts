import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * 插件验证模式的「早期引导」。
 *
 * 必须在任何依赖 userData 的模块（尤其是 `src/main/db/index.ts`，它在模块加载时
 * 就立即 `app.getPath('userData')` 并打开 SQLite）被 import 之前执行 —— 因此本模块
 * 要作为 `src/main/index.ts` 的**第一个 import**。
 *
 * 这样验证模式才能在 DB 初始化前把 userData 切到隔离的临时目录，避免读写用户真实数据，
 * 或与正在运行的 Mulby 抢占同一个 SQLite 文件锁。
 */

/** 一次性验证模式的目标插件目录（未设置则非该模式）。 */
export const VERIFY_PLUGIN_DIR = process.env.MULBY_VERIFY_PLUGIN
/** 是否为 MCP 自动化验证模式（长驻 HTTP MCP server；与一次性模式互斥，MCP 优先）。 */
export const IS_VERIFY_MCP = Boolean(process.env.MULBY_VERIFY_MCP)
/** 是否处于任一验证模式（需隔离 userData、跳过正常启动）。 */
export const IS_VERIFY_MODE = Boolean(VERIFY_PLUGIN_DIR) || IS_VERIFY_MCP

// 验证模式禁用硬件加速：headless 下反复创建/销毁离屏窗口时，GPU 进程合成不稳定，
// 会导致后续渲染的 renderer 无法启动（dom-ready 不触发）。软件渲染更可靠，且验证不在意性能。
// 必须在 app ready 之前调用（本模块是 index.ts 的第一个 import）。
if (IS_VERIFY_MODE) {
  try {
    app.disableHardwareAcceleration()
  } catch {
    /* ignore */
  }
}

/** 隔离的临时 userData 目录（仅验证模式有值），退出时需清理。 */
export const VERIFY_USER_DATA: string | null = IS_VERIFY_MODE ? createIsolatedUserData() : null

function createIsolatedUserData(): string {
  const suffix = Math.random().toString(36).slice(2, 8)
  const dir = join(tmpdir(), `mulby-verify-${process.pid}-${Date.now()}-${suffix}`)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* 目录已存在或无法创建时忽略，setPath 仍会指向该路径 */
  }
  // 必须在 app ready 之前调用；此处处于模块加载阶段，满足要求
  app.setPath('userData', dir)
  return dir
}
