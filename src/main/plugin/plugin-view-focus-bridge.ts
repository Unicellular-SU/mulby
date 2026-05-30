import type { BrowserWindow, WebContentsView } from 'electron'

type FocusBridgeWindow = Pick<BrowserWindow, 'id' | 'on' | 'isDestroyed' | 'isFocused' | 'focus'>
type FocusBridgeWebContents = Pick<Electron.WebContents, 'on' | 'isDestroyed' | 'isFocused' | 'focus'>
type FocusBridgeView = Pick<WebContentsView, 'webContents'> | { webContents: FocusBridgeWebContents }

export function focusPluginViewIfNeeded(pluginView: FocusBridgeView): void {
  const pluginWebContents = pluginView?.webContents
  if (!pluginWebContents || pluginWebContents.isDestroyed()) return
  if (!pluginWebContents.isFocused()) {
    pluginWebContents.focus()
  }
}

export function installPluginViewFocusBridge(win: FocusBridgeWindow, pluginView: FocusBridgeView): () => void {
  const onFocus = () => {
    if (win.isDestroyed()) return
    focusPluginViewIfNeeded(pluginView)
  }

  const onBeforeInputEvent = () => {
    if (!win.isDestroyed() && !win.isFocused()) {
      win.focus()
    }
    focusPluginViewIfNeeded(pluginView)
  }

  win.on('focus', onFocus)
  
  const webContents = pluginView?.webContents
  if (webContents && !webContents.isDestroyed()) {
    webContents.on('before-input-event', onBeforeInputEvent)
  }

  return () => {
    if (!win.isDestroyed()) {
      // Electron BrowserWindow 并没有返回 removeListener，我们需要用 cast 或者 any 来移除
      ;(win as any).removeListener('focus', onFocus)
    }
    if (webContents && !webContents.isDestroyed()) {
      ;(webContents as any).removeListener('before-input-event', onBeforeInputEvent)
    }
  }
}
