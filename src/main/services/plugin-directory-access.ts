import { BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  PluginDirectoryAccessGrant,
  PluginDirectoryAccessMode
} from '../../shared/types/settings'
import { appSettingsManager } from './app-settings'
import { withIgnoringBlur } from './blur-manager'
import { showInternalMessageBox } from './ui-dialog-service'

export interface PluginDirectoryAccessRequestInput {
  path?: string
  mode?: PluginDirectoryAccessMode
  title?: string
  message?: string
  reason?: string
}

interface DirectoryAccessRequestOptions {
  parentWindow?: BrowserWindow | null
}

function normalizeMode(value: unknown): PluginDirectoryAccessMode {
  return value === 'readwrite' ? 'readwrite' : 'read'
}

function normalizePluginId(pluginId: string): string {
  return String(pluginId || '').trim()
}

function normalizeGrantPath(value: string): string {
  return path.resolve(String(value || '').trim())
}

function canSatisfyMode(grantMode: PluginDirectoryAccessMode, requiredMode: PluginDirectoryAccessMode): boolean {
  return requiredMode === 'read' || grantMode === 'readwrite'
}

function sanitizeReason(value: unknown): string | undefined {
  const reason = String(value || '').trim()
  return reason ? reason.slice(0, 500) : undefined
}

async function assertExistingDirectory(dirPath: string): Promise<void> {
  const stat = await fs.stat(dirPath)
  if (!stat.isDirectory()) {
    throw new Error(`目录授权目标不是目录：${dirPath}`)
  }
}

function getParentWindow(options?: DirectoryAccessRequestOptions): BrowserWindow | undefined {
  const win = options?.parentWindow
  if (win && !win.isDestroyed()) return win
  return BrowserWindow.getFocusedWindow() ?? undefined
}

function listAllGrants(): PluginDirectoryAccessGrant[] {
  return appSettingsManager.getSettings().pluginDirectoryAccess.grants || []
}

function saveGrants(grants: PluginDirectoryAccessGrant[]): PluginDirectoryAccessGrant[] {
  return appSettingsManager.updateSettings({
    pluginDirectoryAccess: { grants }
  }).pluginDirectoryAccess.grants
}

function touchGrant(grantId: string): PluginDirectoryAccessGrant | null {
  const grants = listAllGrants()
  const next = grants.map((grant) => (
    grant.id === grantId ? { ...grant, lastUsedAt: Date.now() } : grant
  ))
  return saveGrants(next).find((grant) => grant.id === grantId) || null
}

function upsertGrant(input: {
  pluginId: string
  dirPath: string
  mode: PluginDirectoryAccessMode
  source: PluginDirectoryAccessGrant['source']
  reason?: string
}): PluginDirectoryAccessGrant {
  const now = Date.now()
  const grants = listAllGrants()
  const existing = grants.find((grant) => grant.pluginId === input.pluginId && grant.path === input.dirPath)
  if (existing) {
    const upgradedMode: PluginDirectoryAccessMode = existing.mode === 'readwrite' || input.mode === 'readwrite'
      ? 'readwrite'
      : 'read'
    const next = grants.map((grant) => (
      grant.id === existing.id
        ? {
            ...grant,
            mode: upgradedMode,
            source: input.source,
            reason: input.reason || grant.reason,
            lastUsedAt: now
          }
        : grant
    ))
    return saveGrants(next).find((grant) => grant.id === existing.id) || { ...existing, mode: upgradedMode, lastUsedAt: now }
  }

  const grant: PluginDirectoryAccessGrant = {
    id: `dir-${randomUUID()}`,
    pluginId: input.pluginId,
    path: input.dirPath,
    mode: input.mode,
    source: input.source,
    reason: input.reason,
    createdAt: now,
    lastUsedAt: now
  }
  saveGrants([...grants, grant])
  return grant
}

export function listPluginDirectoryAccess(pluginId: string): PluginDirectoryAccessGrant[] {
  const normalizedPluginId = normalizePluginId(pluginId)
  if (!normalizedPluginId) return []
  return listAllGrants().filter((grant) => grant.pluginId === normalizedPluginId)
}

export function getPluginDirectoryAccessRoots(
  pluginId: string | undefined,
  requiredMode: PluginDirectoryAccessMode = 'read'
): string[] {
  const normalizedPluginId = normalizePluginId(pluginId || '')
  if (!normalizedPluginId) return []
  return listPluginDirectoryAccess(normalizedPluginId)
    .filter((grant) => canSatisfyMode(grant.mode, requiredMode))
    .map((grant) => grant.path)
}

export function getPluginCommandDirectoryAccessRoots(pluginId: string | undefined): {
  read: string[]
  readwrite: string[]
} {
  const normalizedPluginId = normalizePluginId(pluginId || '')
  if (!normalizedPluginId) return { read: [], readwrite: [] }
  const grants = listPluginDirectoryAccess(normalizedPluginId)
  return {
    read: grants.filter((grant) => grant.mode === 'read').map((grant) => grant.path),
    readwrite: grants.filter((grant) => grant.mode === 'readwrite').map((grant) => grant.path)
  }
}

export function revokePluginDirectoryAccess(pluginId: string, grantIdOrPath: string): boolean {
  const normalizedPluginId = normalizePluginId(pluginId)
  const target = String(grantIdOrPath || '').trim()
  if (!normalizedPluginId || !target) return false
  const resolvedTarget = path.isAbsolute(target) ? normalizeGrantPath(target) : ''
  const grants = listAllGrants()
  const next = grants.filter((grant) => {
    if (grant.pluginId !== normalizedPluginId) return true
    return grant.id !== target && (!resolvedTarget || grant.path !== resolvedTarget)
  })
  if (next.length === grants.length) return false
  saveGrants(next)
  return true
}

export async function requestPluginDirectoryAccess(
  pluginId: string,
  input: PluginDirectoryAccessRequestInput = {},
  options?: DirectoryAccessRequestOptions
): Promise<PluginDirectoryAccessGrant | null> {
  const normalizedPluginId = normalizePluginId(pluginId)
  if (!normalizedPluginId) throw new Error('目录授权缺少 pluginId')

  const mode = normalizeMode(input.mode)
  const reason = sanitizeReason(input.reason)
  const parentWindow = getParentWindow(options)
  const requestedPath = String(input.path || '').trim()

  if (!requestedPath) {
    const result = await withIgnoringBlur(async () => {
      const dialogOptions: Electron.OpenDialogOptions = {
        title: input.title || (mode === 'readwrite' ? '授权插件读写目录' : '授权插件读取目录'),
        buttonLabel: mode === 'readwrite' ? '授权读写' : '授权读取',
        properties: ['openDirectory']
      }
      return parentWindow
        ? await dialog.showOpenDialog(parentWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const dirPath = normalizeGrantPath(result.filePaths[0])
    await assertExistingDirectory(dirPath)
    return upsertGrant({
      pluginId: normalizedPluginId,
      dirPath,
      mode,
      source: 'picker',
      reason
    })
  }

  const dirPath = normalizeGrantPath(requestedPath)
  await assertExistingDirectory(dirPath)
  const existing = listPluginDirectoryAccess(normalizedPluginId)
    .find((grant) => grant.path === dirPath && canSatisfyMode(grant.mode, mode))
  if (existing) return touchGrant(existing.id) || existing

  const detail = [
    `插件：${normalizedPluginId}`,
    `目录：${dirPath}`,
    `权限：${mode === 'readwrite' ? '读写' : '读取'}`,
    reason ? `原因：${reason}` : ''
  ].filter(Boolean).join('\n')
  const result = await showInternalMessageBox({
    type: 'warning',
    title: input.title || '插件请求目录访问',
    message: input.message || '是否允许该插件访问这个目录？',
    detail,
    buttons: ['拒绝', mode === 'readwrite' ? '允许读写' : '允许读取'],
    defaultId: 0,
    cancelId: 0
  }, { parentWindow })
  if (result.response !== 1) return null

  return upsertGrant({
    pluginId: normalizedPluginId,
    dirPath,
    mode,
    source: 'path-confirmation',
    reason
  })
}
