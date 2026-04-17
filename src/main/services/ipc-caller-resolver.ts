/**
 * IPC 调用方来源解析器
 *
 * 通过 event.sender (WebContents) 识别 IPC 调用源：
 * - 主窗口 / 设置页 / 系统页 → source: 'app'
 * - 插件独立窗口 / 面板窗口 → source: 'plugin'（携带 pluginId）
 *
 * 解决安全问题：防止插件 renderer 通过通用 preload 暴露的
 * shell:runCommand IPC 通道以 source:'app' 身份绕过权限检查。
 */

import { windowFromWebContents } from './webcontents-registry'

/** IPC 调用方信息 */
export interface IpcCallerInfo {
  /** 来源类型 */
  source: 'app' | 'plugin' | 'untrusted'
  /** 插件 ID（仅 source='plugin' 时有值） */
  pluginId?: string
  /** 宿主 BrowserWindow ID */
  windowId?: number
}

/**
 * 插件窗口注册表
 *
 * 由 PluginWindowManager 在创建/销毁窗口时维护。
 * 存储 BrowserWindow.id → pluginId 的映射。
 */
const pluginWindowRegistry = new Map<number, string>()

/**
 * 面板窗口注册表
 *
 * 由 PluginPanelWindow 在创建/销毁面板时维护。
 * 存储 BrowserWindow.id → pluginId 的映射。
 */
const panelWindowRegistry = new Map<number, string>()

/**
 * 主窗口 ID 集合
 *
 * 由主进程启动时注册，包含主搜索框窗口和系统页窗口等。
 */
const appWindowIds = new Set<number>()

/**
 * 系统内部工具窗口 ID 集合（hidden worker、UI dialog、canvas、region-capture 等）
 *
 * 这些窗口不加载 mulby preload，正常情况下不会调用任何 mulby IPC，
 * 但显式标记能避免未来改动引入的静默拒绝，并且给可观测性提供更明确的分类。
 *
 * 与 appWindowIds 的区别：系统内部窗口对 shell:runCommand 等高风险 IPC
 * 依然会被视为 'untrusted'（source !== 'app'），但日志告警中会明确标明是
 * "系统内部窗口意外触发 IPC" 而非"未知发送方"。
 */
const systemInternalWindowIds = new Set<number>()

/**
 * 已打印过告警的窗口 ID 集合（去重，避免日志泛滥）
 */
const warnedWindowIds = new Set<number>()

// ==================== 注册 API ====================

/**
 * 注册插件独立窗口（由 PluginWindowManager 调用）
 */
export function registerPluginWindow(windowId: number, pluginId: string): void {
  appWindowIds.delete(windowId)
  pluginWindowRegistry.set(windowId, pluginId)
}

/**
 * 注销插件独立窗口（由 PluginWindowManager 调用）
 */
export function unregisterPluginWindow(windowId: number): void {
  pluginWindowRegistry.delete(windowId)
}

/**
 * 注册面板窗口（由 PluginPanelWindow 调用）
 */
export function registerPanelWindow(windowId: number, pluginId: string): void {
  appWindowIds.delete(windowId)
  panelWindowRegistry.set(windowId, pluginId)
}

/**
 * 注销面板窗口（由 PluginPanelWindow 调用）
 */
export function unregisterPanelWindow(windowId: number): void {
  panelWindowRegistry.delete(windowId)
}

/**
 * 注册主应用窗口（由主进程调用）
 */
export function registerAppWindow(windowId: number): void {
  systemInternalWindowIds.delete(windowId)
  appWindowIds.add(windowId)
}

/**
 * 注销主应用窗口
 */
export function unregisterAppWindow(windowId: number): void {
  appWindowIds.delete(windowId)
  warnedWindowIds.delete(windowId)
}

/**
 * 注册系统内部工具窗口（不参与 mulby IPC，但显式标记以便可观测性）
 *
 * 适用于：UI dialog、hidden search worker、canvas 窗口、截屏 / 取色窗口等
 * 这类窗口如果意外触发 IPC，能通过 windowId 关联到来源
 */
export function registerSystemInternalWindow(windowId: number): void {
  appWindowIds.delete(windowId)
  systemInternalWindowIds.add(windowId)
}

/**
 * 注销系统内部工具窗口
 */
export function unregisterSystemInternalWindow(windowId: number): void {
  systemInternalWindowIds.delete(windowId)
  warnedWindowIds.delete(windowId)
}

// ==================== 解析 API ====================

/**
 * 解析 IPC 调用方来源
 *
 * 查找链路：
 * 1. sender → BrowserWindow.fromWebContents（直接持有）
 * 2. 若为 null → webcontents-registry 反查（WebContentsView 架构）
 * 3. 获取到宿主 BrowserWindow 后，依次查询：
 *    - pluginWindowRegistry（独立窗口）
 *    - panelWindowRegistry（面板窗口）
 *    - appWindowIds（主窗口/系统页）
 * 4. 兜底：未知来源视为 'app'（安全保守策略）
 *
 * @param sender IPC 事件的 sender (WebContents)
 */
export function resolveIpcCallerSource(sender: Electron.WebContents): IpcCallerInfo {
  const win = windowFromWebContents(sender)
  if (!win) {
    // 找不到宿主窗口（极罕见），保守返回 untrusted 并告警
    warnUntrusted(null, 'webcontents 无法关联到任何 BrowserWindow')
    return { source: 'untrusted' }
  }

  const windowId = win.id

  const pluginId = pluginWindowRegistry.get(windowId)
  if (pluginId) {
    return { source: 'plugin', pluginId, windowId }
  }

  const panelPluginId = panelWindowRegistry.get(windowId)
  if (panelPluginId) {
    return { source: 'plugin', pluginId: panelPluginId, windowId }
  }

  if (appWindowIds.has(windowId)) {
    return { source: 'app', windowId }
  }

  // 系统内部窗口：不是 App 但已显式登记为系统内部工具窗口
  // —— 静默返回 untrusted（IPC 不放行），不打印告警（因为已知场景）
  if (systemInternalWindowIds.has(windowId)) {
    return { source: 'untrusted', windowId }
  }

  // 兜底：未登记窗口，打印去重告警以协助排查
  warnUntrusted(windowId, sender)
  return { source: 'untrusted', windowId }
}

/**
 * 打印 untrusted 告警（同一窗口仅打印一次，避免日志泛滥）
 */
function warnUntrusted(windowId: number | null, detail: Electron.WebContents | string): void {
  if (windowId !== null) {
    if (warnedWindowIds.has(windowId)) return
    warnedWindowIds.add(windowId)
  }
  let desc = ''
  try {
    if (typeof detail === 'string') {
      desc = detail
    } else {
      const url = detail.getURL?.() || ''
      desc = `url=${url || '(empty)'}`
    }
  } catch {
    desc = '(unavailable)'
  }
  // 使用 console.warn 而非 loggerService 避免循环依赖
  console.warn(`[ipc-caller-resolver] 拦截到未登记窗口 (windowId=${windowId ?? 'n/a'}) 的 IPC 调用 — ${desc}`)
}
