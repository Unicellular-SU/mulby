/**
 * 插件网络日志桥
 *
 * 把插件触发的网络请求（mulby.http / mulby.ai 经主进程发出，以及后端 utilityProcess
 * 内第三方库 / 原生 fetch 发出的请求），在开发者模式下以可折叠的 console 分组回灌到
 * 该插件 UI 视图的 DevTools 控制台，弥补"DevTools 网络面板看不到跨进程请求"的盲区。
 *
 * 这是 {@link setupPluginDevtoolsBridge}（后端 console 桥）的姊妹实现，复用同一套
 * 注入与零宽标记跳过机制：
 * - 仅在 developer.enabled 时转发，正常用户零开销（采集点用 channel.enabled 短路）。
 * - 注入文本带 {@link PLUGIN_NETWORK_CONSOLE_MARKER} 前缀，console-capture 跳过它，
 *   避免可观测性输出污染持久化日志文件。
 * - 通过 executeJavaScript + JSON.stringify 安全注入，杜绝脚本注入。
 */
import type { PluginWindowManager } from './window'
import type { AppSettingsManager } from '../services/app-settings'
import {
  pluginNetworkChannel,
  PLUGIN_NETWORK_RECORD_EVENT,
  type PluginNetworkRecord
} from './plugin-network-channel'
import { PLUGIN_NETWORK_CONSOLE_MARKER } from './console-capture'
import log from 'electron-log'

const M = PLUGIN_NETWORK_CONSOLE_MARKER

function hasEntries(obj: Record<string, unknown> | undefined): boolean {
  return !!obj && Object.keys(obj).length > 0
}

function buildInjectionScript(record: PluginNetworkRecord): string {
  const J = (v: unknown) => JSON.stringify(v)

  const statusPart = record.error
    ? 'ERR'
    : record.status != null
      ? String(record.status)
      : record.ok
        ? 'OK'
        : '...'
  const durPart = record.durationMs != null ? ` (${record.durationMs}ms)` : ''
  const label = `[network:${record.source}] ${record.method} ${record.url} → ${statusPart}${durPart}`

  const isError = !!record.error || (record.status != null && record.status >= 400)
  const color = isError ? '#e5534b' : '#3fb950'

  const lines: string[] = []
  const detail = (title: string, value: unknown) => {
    lines.push(`c.log(${J(M + title)}, ${J(value)})`)
  }
  if (record.error) detail('✖ Error', record.error)
  if (hasEntries(record.requestHeaders)) detail('▸ Request Headers', record.requestHeaders)
  if (record.requestBodyPreview) detail('▸ Request Body', record.requestBodyPreview)
  if (hasEntries(record.responseHeaders)) detail('◂ Response Headers', record.responseHeaders)
  if (record.responseBodyPreview) detail('◂ Response Body', record.responseBodyPreview)
  if (hasEntries(record.meta)) detail('• Meta', record.meta)

  // 把零宽标记放在 %c 之前：无论 console-message 回传的是格式化后文本还是原始格式串，
  // 该消息都以标记开头，从而被 console-capture 跳过、不落盘。%c 之后的内容着色。
  const style = `color:${color};font-weight:normal`
  // groupEnd 也带上零宽标记：否则 Electron 会就 console.groupEnd() 触发一条
  // message 为 'console.groupEnd' 的 console-message，被 console-capture 落盘成噪声。
  // groupEnd 忽略实参、仍正确闭合分组，标记为零宽字符在 DevTools 中不可见。
  return `(function(){try{var c=console;` +
    `c.groupCollapsed(${J(M)}+'%c'+${J(label)}, ${J(style)});` +
    `${lines.join(';')}${lines.length ? ';' : ''}` +
    `c.groupEnd(${J(M)});` +
    `}catch(e){}})()`
}

function injectNetworkRecord(wc: Electron.WebContents, record: PluginNetworkRecord): void {
  if (wc.isDestroyed()) return
  try {
    void wc.executeJavaScript(buildInjectionScript(record)).catch(() => {})
  } catch {
    // webContents 正在销毁/导航时可能同步抛错，忽略
  }
}

/**
 * 装配插件网络日志桥。应在 pluginWindowManager / appSettingsManager 就绪后调用一次。
 * 同时把"是否启用采集"的判定注入网络通道，作为所有采集点的唯一开关。
 */
export function setupPluginNetworkBridge(
  pluginWindowManager: PluginWindowManager,
  appSettingsManager: AppSettingsManager
): void {
  pluginNetworkChannel.setGate(() => appSettingsManager.getSettings().developer.enabled === true)

  pluginNetworkChannel.on(PLUGIN_NETWORK_RECORD_EVENT, (pluginId: string, record: PluginNetworkRecord) => {
    if (!pluginNetworkChannel.enabled) return
    const targets = pluginWindowManager.getPluginViewWebContentsList(pluginId)
    for (const wc of targets) {
      injectNetworkRecord(wc, record)
    }
  })

  log.info('[PluginNetworkBridge] network log bridge installed')
}
