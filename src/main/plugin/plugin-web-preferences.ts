import type { WebContents } from 'electron'
import type { Plugin, PluginRendererCapabilities } from '../../shared/types/plugin'

export const PLUGIN_RENDERER_V8_CACHE_OPTIONS = 'code' as const

export function hasPluginWebviewPermission(plugin: Plugin): boolean {
  return plugin.manifest.permissions?.webview === true
}

export function getPluginRendererCapabilities(plugin: Plugin): PluginRendererCapabilities {
  return {
    webview: hasPluginWebviewPermission(plugin)
  }
}

export function getPluginRendererWebPreferences(plugin: Plugin): { webviewTag?: true } {
  return hasPluginWebviewPermission(plugin) ? { webviewTag: true } : {}
}

export function installPluginWebviewSecurity(webContents: WebContents, plugin: Plugin): void {
  const webviewAllowed = hasPluginWebviewPermission(plugin)

  webContents.on('will-attach-webview', (event, webPreferences) => {
    if (!webviewAllowed) {
      event.preventDefault()
      return
    }

    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.nodeIntegrationInWorker = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webviewTag = false
  })
}
