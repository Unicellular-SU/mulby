/**
 * internal-plugins.ts — 内置插件管理模块
 *
 * 管理内置在应用中的「虚拟插件」，典型代表是系统插件。
 * 内置插件没有可执行代码（无 main.js），
 * 仅由 manifest.json + 图标资源组成，
 * 执行时由主进程内建处理函数直接执行。
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import log from 'electron-log'

/** 系统插件保留名称（双下划线前缀避免与用户插件冲突） */
export const SYSTEM_PLUGIN_NAME = '__mulby_system'

/**
 * 判断插件是否为内置系统插件
 */
export function isSystemPlugin(pluginId: string): boolean {
  return pluginId === SYSTEM_PLUGIN_NAME
}

/**
 * 获取内置插件目录的绝对路径
 *
 * 开发模式：process.cwd()/internal-plugins/<name>
 * 生产模式：process.resourcesPath/internal-plugins/<name>
 */
export function getInternalPluginPath(name: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'internal-plugins', name)
  }
  return join(process.cwd(), 'internal-plugins', name)
}

/**
 * 获取所有内置插件的目录路径列表
 * 当前仅包含 system 插件，后续可扩展
 */
export function getInternalPluginDirs(): string[] {
  const dirs: string[] = []

  const systemDir = getInternalPluginPath('system')
  if (existsSync(systemDir)) {
    dirs.push(systemDir)
  } else {
    log.warn(`[InternalPlugins] 系统插件目录不存在: ${systemDir}`)
  }

  return dirs
}
