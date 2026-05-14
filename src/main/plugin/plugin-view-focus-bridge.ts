import type { BrowserWindow, WebContentsView } from 'electron'

type FocusBridgeWindow = Pick<BrowserWindow, 'id' | 'on' | 'isDestroyed' | 'isFocused' | 'focus'>
type FocusBridgeWebContents = Pick<Electron.WebContents, 'on' | 'isDestroyed' | 'isFocused' | 'focus'>
type FocusBridgeView = Pick<WebContentsView, 'webContents'> | { webContents: FocusBridgeWebContents }

export function focusPluginViewIfNeeded(pluginView: FocusBridgeView): void {
  const pluginWebContents = pluginView.webContents
  if (pluginWebContents.isDestroyed()) return
  if (!pluginWebContents.isFocused()) {
    pluginWebContents.focus()
  }
}

export function installPluginViewFocusBridge(win: FocusBridgeWindow, pluginView: FocusBridgeView): void {
  win.on('focus', () => {
    if (win.isDestroyed()) return
    focusPluginViewIfNeeded(pluginView)
  })

  pluginView.webContents.on('before-input-event', () => {
    if (!win.isDestroyed() && !win.isFocused()) {
      win.focus()
    }
    focusPluginViewIfNeeded(pluginView)
  })
}
