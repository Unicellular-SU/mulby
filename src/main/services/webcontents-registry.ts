import { BrowserWindow, WebContentsView } from 'electron'

/**
 * WebContents 注册表
 *
 * 当插件内容运行在 WebContentsView 中时，Electron 的
 * BrowserWindow.fromWebContents() 会返回 null —— 因为 WebContentsView
 * 并不关联到 BrowserWindow。本注册表维护一个
 *   pluginWebContentsId → parentBrowserWindow
 * 的映射，使得所有 IPC handler 依然能正确找到
 * 发送者所在的宿主 BrowserWindow。
 */

/** pluginWebContentsId → BrowserWindow */
const viewToWindowMap = new Map<number, BrowserWindow>()

/** pluginWebContentsId → WebContentsView */
const viewMap = new Map<number, WebContentsView>()

/**
 * 注册 WebContentsView 与其宿主 BrowserWindow 的关系。
 * 在创建带有 WebContentsView 架构的独立窗口后立即调用。
 */
export function registerView(view: WebContentsView, hostWindow: BrowserWindow): void {
  const wcId = view.webContents.id
  viewToWindowMap.set(wcId, hostWindow)
  viewMap.set(wcId, view)

  // 当 WebContents 被销毁时自动清理
  view.webContents.once('destroyed', () => {
    viewToWindowMap.delete(wcId)
    viewMap.delete(wcId)
  })
}

/**
 * 注销 WebContentsView 的注册。
 * 通常不需要手动调用（destroyed 事件会自动清理），
 * 但在显式销毁 view 前可以提前调用。
 */
export function unregisterView(viewOrId: WebContentsView | number): void {
  const wcId = typeof viewOrId === 'number' ? viewOrId : viewOrId.webContents.id
  viewToWindowMap.delete(wcId)
  viewMap.delete(wcId)
}

/**
 * 增强版 BrowserWindow.fromWebContents —— 先查 Electron 内置映射，
 * 若为 null 则查 WebContentsView 注册表。
 *
 * 用于替换所有 IPC handler 中的 `BrowserWindow.fromWebContents(event.sender)`。
 */
export function windowFromWebContents(wc: Electron.WebContents): BrowserWindow | null {
  // 1. 优先走 Electron 原生路径（BrowserWindow 直接持有的 webContents）
  const win = BrowserWindow.fromWebContents(wc)
  if (win) return win

  // 2. 在 WebContentsView 注册表中查找
  return viewToWindowMap.get(wc.id) ?? null
}

/**
 * 根据 webContents ID 查找注册的 WebContentsView。
 */
export function getRegisteredView(webContentsId: number): WebContentsView | null {
  return viewMap.get(webContentsId) ?? null
}

/**
 * 获取 WebContentsView 对应的宿主 BrowserWindow。
 */
export function getHostWindow(webContentsId: number): BrowserWindow | null {
  return viewToWindowMap.get(webContentsId) ?? null
}

/**
 * 反向查找：给定一个 BrowserWindow，返回其关联的插件 WebContentsView 的 webContents。
 * 用于 reload、主题发送、子窗口消息等场景：这些场景需要操作插件内容而非标题栏。
 * 如果该窗口没有注册的 WebContentsView（无标题栏模式），返回 null。
 */
export function getPluginWebContents(win: BrowserWindow): Electron.WebContents | null {
  for (const [wcId, hostWin] of viewToWindowMap) {
    if (hostWin === win || hostWin.id === win.id) {
      const view = viewMap.get(wcId)
      if (view && !view.webContents.isDestroyed()) {
        return view.webContents
      }
    }
  }
  return null
}
