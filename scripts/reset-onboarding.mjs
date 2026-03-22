#!/usr/bin/env node

/**
 * 重置引导流程脚本
 * 将 onboardingCompleted 设为 false，下次启动时重新显示引导窗口。
 * 适配 macOS / Windows / Linux，使用 sqlite3 CLI 避免原生模块版本问题。
 *
 * 用法：node scripts/reset-onboarding.mjs
 */

import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// 根据平台确定 Electron userData 路径
function getUserDataPath() {
  const home = homedir()
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Mulby')
    case 'win32':
      // Windows 不区分大小写，但保持一致
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Mulby')
    case 'linux':
      return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Mulby')
    default:
      throw new Error(`不支持的平台: ${platform()}`)
  }
}

const dbPath = join(getUserDataPath(), 'db', 'storage.db')

if (!existsSync(dbPath)) {
  console.error(`❌ 数据库文件不存在: ${dbPath}`)
  console.error('   请确认 Mulby 已至少运行过一次。')
  process.exit(1)
}

// 使用 sqlite3 CLI 更新设置
const sql = `UPDATE store SET value = json_set(value, '$.onboardingCompleted', json('false')), updated_at = ${Date.now()} WHERE plugin_id = 'app' AND key = 'settings' AND json_extract(value, '$.onboardingCompleted') = 1;`

try {
  execFileSync('sqlite3', [dbPath, sql], { stdio: 'pipe' })
  console.log('✅ 已重置引导流程。下次启动 Mulby 时将重新显示引导窗口。')
} catch (err) {
  console.error('❌ 执行失败:', err.message)
  console.error('   请确认系统已安装 sqlite3 命令行工具。')
  console.error(`   macOS: brew install sqlite3`)
  console.error(`   Windows: 从 https://sqlite.org/download.html 下载`)
  process.exit(1)
}
