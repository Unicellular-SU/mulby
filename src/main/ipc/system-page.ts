import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  type OpenSystemPagePayload,
  type SettingsCenterSection,
  type SystemPageId,
  SystemPageWindowManager
} from '../services/system-page-window-manager'
import { windowFromWebContents } from '../services/webcontents-registry'

const SYSTEM_PAGE_IDS: SystemPageId[] = [
  'settings',
  'plugin-manager',
  'plugin-store',
  'background-plugins',
  'task-scheduler',
  'log-viewer',
  'storage-explorer',
  'ai-settings',
  'ai-mcp-settings',
  'ai-skills-settings'
]

const SETTINGS_SECTIONS: SettingsCenterSection[] = [
  'dashboard',
  'general',
  'shortcuts',
  'commandQuickLaunch',
  'commandAll',
  'permissions',
  'security',
  'developer',
  'about'
]

function isMainWindowCaller(event: IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null): boolean {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return false
  return event.sender.id === mainWindow.webContents.id
}

function normalizeOpenPayload(input: unknown): OpenSystemPagePayload | null {
  if (!input || typeof input !== 'object') return null
  const payload = input as Record<string, unknown>
  const rawPage = payload.page
  if (typeof rawPage !== 'string') return null
  if (!SYSTEM_PAGE_IDS.includes(rawPage as SystemPageId)) return null

  if (rawPage !== 'settings') {
    return { page: rawPage as SystemPageId }
  }

  const section = payload.settingsSection
  const normalizedSection = typeof section === 'string' && SETTINGS_SECTIONS.includes(section as SettingsCenterSection)
    ? section as SettingsCenterSection
    : 'dashboard'
  const shortcutCommandHint = typeof payload.shortcutCommandHint === 'string'
    ? payload.shortcutCommandHint
    : ''

  return {
    page: 'settings',
    settingsSection: normalizedSection,
    shortcutCommandHint
  }
}

export function registerSystemPageHandlers(
  getMainWindow: () => BrowserWindow | null,
  manager: SystemPageWindowManager
) {
  ipcMain.handle('systemPage:open', async (event, payload: unknown) => {
    if (!isMainWindowCaller(event, getMainWindow)) return false
    const normalized = normalizeOpenPayload(payload)
    if (!normalized) return false
    return await manager.openAttached(normalized)
  })

  ipcMain.handle('systemPage:close', (event) => {
    const caller = windowFromWebContents(event.sender)
    return manager.closeByCaller(caller)
  })

  ipcMain.handle('systemPage:detach', async (event) => {
    const caller = windowFromWebContents(event.sender)
    return await manager.detachByCaller(caller)
  })

  ipcMain.handle('systemPage:reload', (event) => {
    const caller = windowFromWebContents(event.sender)
    return manager.reloadByCaller(caller)
  })

  ipcMain.handle('systemPage:getState', () => {
    return manager.getState()
  })

  ipcMain.handle('systemPage:getMode', (event) => {
    const caller = windowFromWebContents(event.sender)
    return manager.getModeByWindow(caller)
  })
}
