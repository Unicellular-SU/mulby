import { ipcMain } from 'electron'
import { pluginAwareInvoke } from './_shared/caller-middleware'
import { windowFromWebContents } from '../services/webcontents-registry'
import {
  listPluginDirectoryAccess,
  requestPluginDirectoryAccess,
  revokePluginDirectoryAccess,
  type PluginDirectoryAccessRequestInput
} from '../services/plugin-directory-access'

function requirePlugin(caller: { source: string; pluginId?: string }): string {
  if (caller.source !== 'plugin' || !caller.pluginId) {
    throw new Error('仅插件可申请目录授权')
  }
  return caller.pluginId
}

export function registerDirectoryAccessHandlers() {
  ipcMain.handle('directoryAccess:request', pluginAwareInvoke(async (caller, event, input?: PluginDirectoryAccessRequestInput) => {
    const pluginId = requirePlugin(caller)
    return requestPluginDirectoryAccess(pluginId, input || {}, {
      parentWindow: windowFromWebContents(event.sender)
    })
  }))

  ipcMain.handle('directoryAccess:list', pluginAwareInvoke((caller) => {
    const pluginId = requirePlugin(caller)
    return listPluginDirectoryAccess(pluginId)
  }))

  ipcMain.handle('directoryAccess:revoke', pluginAwareInvoke((caller, _event, grantIdOrPath: string) => {
    const pluginId = requirePlugin(caller)
    return revokePluginDirectoryAccess(pluginId, grantIdOrPath)
  }))
}
