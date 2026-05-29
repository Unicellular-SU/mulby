/**
 * 插件后端日志桥
 *
 * 把插件后端（utilityProcess host）的 stdout / stderr / 未捕获异常 / 崩溃退出，
 * 回灌到该插件 UI 视图的 DevTools 控制台，便于开发者直接在插件 DevTools 里调试后端，
 * 而不必去翻主进程日志文件。
 *
 * 设计要点：
 * - 仅在开发者模式（developer.enabled）下转发，正常用户零开销。
 * - 注入文本带零宽标记 {@link BACKEND_BRIDGE_CONSOLE_MARKER}，console-capture 会跳过它，
 *   避免后端输出被记录两次。
 * - 通过 executeJavaScript + JSON.stringify 安全注入，杜绝脚本注入。
 */
import type { PluginHostManager } from './host-manager'
import type { PluginWindowManager } from './window'
import type { AppSettingsManager } from '../services/app-settings'
import { BACKEND_BRIDGE_CONSOLE_MARKER } from './console-capture'
import log from 'electron-log'

type ConsoleLevel = 'log' | 'error'

function injectToConsole(
  wc: Electron.WebContents,
  level: ConsoleLevel,
  text: string
): void {
  if (wc.isDestroyed()) return
  const consoleFn = level === 'error' ? 'console.error' : 'console.log'
  const payload = JSON.stringify(`${BACKEND_BRIDGE_CONSOLE_MARKER}[plugin-backend] ${text}`)
  try {
    void wc.executeJavaScript(`${consoleFn}(${payload})`).catch(() => {})
  } catch {
    // webContents 正在销毁/导航时可能同步抛错，忽略
  }
}

/**
 * 装配后端日志桥。应在 hostManager / pluginWindowManager / appSettingsManager
 * 均已就绪后调用一次（幂等性由调用方保证）。
 */
export function setupPluginDevtoolsBridge(
  hostManager: PluginHostManager,
  pluginWindowManager: PluginWindowManager,
  appSettingsManager: AppSettingsManager
): void {
  const isDevEnabled = () => appSettingsManager.getSettings().developer.enabled === true

  const forward = (pluginId: string, level: ConsoleLevel, text: string) => {
    if (!isDevEnabled()) return
    const targets = pluginWindowManager.getPluginViewWebContentsList(pluginId)
    for (const wc of targets) {
      injectToConsole(wc, level, text)
    }
  }

  hostManager.on('host:console', (pluginId: string, level: ConsoleLevel, text: string) => {
    forward(pluginId, level, text)
  })

  hostManager.on('host:exit', (pluginId: string, code: number) => {
    if (code === 0) return
    forward(pluginId, 'error', `后端进程异常退出（exit code ${code}）。请检查后端日志或 main.ts 是否抛出未捕获异常。`)
  })

  log.info('[PluginDevtoolsBridge] backend log bridge installed')
}
