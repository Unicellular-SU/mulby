/**
 * OpenClaw IPC Handlers
 *
 * 注册 openclaw:* IPC 通道，供 renderer 通过 preload API 调用。
 */

import { ipcMain, BrowserWindow } from 'electron'
import type { OpenClawNodeService } from '../openclaw'
import type { AppSettingsManager } from '../services/app-settings'
import type { OpenClawSettings } from '../../shared/types/settings'
import { openclawLogger } from '../openclaw/logger'
import type { NodeStatusInfo } from '../../shared/types/openclaw-protocol'

export interface OpenClawHandlerDeps {
  openclawService: OpenClawNodeService
  settingsManager: AppSettingsManager
}

/**
 * 向所有活跃 BrowserWindow 广播事件（主窗口 + Settings 窗口等）
 */
function broadcastToAllWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

export function registerOpenClawHandlers(deps: OpenClawHandlerDeps): void {
  const { openclawService, settingsManager } = deps

  // 获取当前 OpenClaw 配置
  ipcMain.handle('openclaw:getSettings', async (): Promise<OpenClawSettings> => {
    const settings = await settingsManager.getSettings()
    return settings.openclaw
  })

  // 更新 OpenClaw 配置（可能触发重连或安全策略热更新）
  ipcMain.handle('openclaw:updateSettings', async (_, partial: Partial<OpenClawSettings>): Promise<OpenClawSettings> => {
    const current = await settingsManager.getSettings()
    const merged = {
      ...current.openclaw,
      ...partial,
      gateway: {
        ...current.openclaw.gateway,
        ...(partial.gateway || {})
      },
      auth: {
        ...current.openclaw.auth,
        ...(partial.auth || {})
      },
      node: {
        ...current.openclaw.node,
        ...(partial.node || {})
      },
      security: {
        ...current.openclaw.security,
        ...(partial.security || {})
      }
    }

    await settingsManager.updateSettings({ openclaw: merged })
    const updated = await settingsManager.getSettings()

    // 判断是否需要重连
    // Gateway 地址/端口/token 变更需要重连
    const gatewayChanged = partial.gateway?.host !== undefined ||
      partial.gateway?.port !== undefined ||
      partial.gateway?.useTls !== undefined ||
      partial.auth?.token !== undefined
    // 能力开关/节点名称变更也需要重连（这些在 connect 握手中发送，无法热更新）
    const capsChanged = partial.security?.exposePlugins !== undefined ||
      partial.security?.exposeSearch !== undefined ||
      partial.security?.exposeClipboard !== undefined ||
      partial.node?.displayName !== undefined

    const currentStatus = openclawService.getStatus().status

    if ((gatewayChanged || capsChanged) && (currentStatus === 'connected' || currentStatus === 'pairing')) {
      // 需要断开重连以更新 Gateway 元数据
      openclawService.disconnect()
      if (updated.openclaw.enabled) {
        void openclawService.connect(updated.openclaw)
      }
    } else {
      // 安全策略/enabled 等变更 → 热更新到活跃会话（enabled=false 时内部会主动断连）
      openclawService.updateSettings(updated.openclaw)
    }

    return updated.openclaw
  })

  // 手动连接
  ipcMain.handle('openclaw:connect', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const settings = await settingsManager.getSettings()
      if (!settings.openclaw.enabled) {
        return { ok: false, error: 'OpenClaw 未启用' }
      }
      await openclawService.connect(settings.openclaw)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 断开连接
  ipcMain.handle('openclaw:disconnect', async (): Promise<void> => {
    openclawService.disconnect()
  })

  // 获取连接状态
  ipcMain.handle('openclaw:getStatus', (): NodeStatusInfo => {
    return openclawService.getStatus()
  })

  // 测试 Gateway 连通性
  ipcMain.handle('openclaw:testConnection', async (_, settings: OpenClawSettings): Promise<{ ok: boolean; error?: string }> => {
    return openclawService.testConnection(settings)
  })

  // 状态变化事件：广播到所有窗口（主窗口 + Settings 窗口等）
  openclawService.onStatusChanged((status) => {
    broadcastToAllWindows('openclaw:statusChanged', status)
  })

  // 命令调用事件：广播到所有窗口
  openclawService.onInvoked((command, success) => {
    broadcastToAllWindows('openclaw:invoked', { command, success, timestamp: Date.now() })
  })

  // 日志 IPC
  ipcMain.handle('openclaw:getLogs', () => {
    return openclawLogger.getAll()
  })

  ipcMain.handle('openclaw:clearLogs', () => {
    openclawLogger.clear()
  })

  // 订阅日志流：实时推送新日志到渲染进程
  openclawLogger.on('log', (entry) => {
    broadcastToAllWindows('openclaw:log', entry)
  })
  openclawLogger.on('clear', () => {
    broadcastToAllWindows('openclaw:logsCleared', null)
  })
}
