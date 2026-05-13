import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  pluginSystem,
  type PathName,
  type SystemIconTraceContext,
  type SystemIconBatchOptions,
  type SystemIconRequest,
  type SystemIconSingleOptions
} from '../plugin/system'
import { resolveIpcCallerSource, type IpcCallerInfo } from '../services/ipc-caller-resolver'
import { recordCrashBreadcrumb } from '../services/crash-breadcrumbs'

const TRACE_PLUGIN_ID = '@mulby/showcase'

function createSystemIconTraceContext(
  event: IpcMainInvokeEvent,
  channel: string
): SystemIconTraceContext {
  const caller = resolveIpcCallerSource(event.sender)
  return {
    pluginId: caller.pluginId,
    callerSource: caller.source,
    windowId: caller.windowId,
    webContentsId: event.sender.id,
    channel
  }
}

function recordShowcaseSystemIpc(
  event: string,
  caller: IpcCallerInfo,
  data: Record<string, unknown> = {}
): void {
  if (caller.pluginId !== TRACE_PLUGIN_ID) return
  recordCrashBreadcrumb(event, {
    pluginId: caller.pluginId,
    callerSource: caller.source,
    windowId: caller.windowId,
    ...data
  })
}

export function registerSystemHandlers() {
  // 获取系统信息
  ipcMain.handle('system:getSystemInfo', () => {
    return pluginSystem.getSystemInfo()
  })

  // 获取应用信息
  ipcMain.handle('system:getAppInfo', () => {
    return pluginSystem.getAppInfo()
  })

  // 获取当前应用资源占用
  ipcMain.handle('system:getAppResourceUsage', () => {
    return pluginSystem.getAppResourceUsage()
  })

  // 获取特定路径
  ipcMain.handle('system:getPath', (_, name: PathName) => {
    return pluginSystem.getPath(name)
  })

  // 获取环境变量
  ipcMain.handle('system:getEnv', (_, name: string) => {
    return pluginSystem.getEnv(name)
  })

  // 获取系统空闲时间
  ipcMain.handle('system:getIdleTime', () => {
    return pluginSystem.getIdleTime()
  })

  // 获取文件图标 (新增)
  ipcMain.handle('system:getFileIcon', async (event, filePath: string, options?: SystemIconSingleOptions) => {
    const traceContext = createSystemIconTraceContext(event, 'system:getFileIcon')
    const caller = {
      source: traceContext.callerSource,
      pluginId: traceContext.pluginId,
      windowId: traceContext.windowId
    } as IpcCallerInfo
    recordShowcaseSystemIpc('system.ipc:getFileIcon:start', caller, {
      webContentsId: traceContext.webContentsId,
      filePath,
      options
    })
    try {
      const icon = await pluginSystem.getFileIcon(filePath, options, traceContext)
      recordShowcaseSystemIpc('system.ipc:getFileIcon:done', caller, {
        webContentsId: traceContext.webContentsId,
        filePath,
        hasIcon: Boolean(icon),
        length: icon.length
      })
      return icon
    } catch (error) {
      recordShowcaseSystemIpc('system.ipc:getFileIcon:error', caller, {
        webContentsId: traceContext.webContentsId,
        filePath,
        error
      })
      throw error
    }
  })

  ipcMain.handle(
    'system:getFileIcons',
    async (event, requests: SystemIconRequest[], options?: SystemIconBatchOptions) => {
      const traceContext = createSystemIconTraceContext(event, 'system:getFileIcons')
      const caller = {
        source: traceContext.callerSource,
        pluginId: traceContext.pluginId,
        windowId: traceContext.windowId
      } as IpcCallerInfo
      recordShowcaseSystemIpc('system.ipc:getFileIcons:start', caller, {
        webContentsId: traceContext.webContentsId,
        count: Array.isArray(requests) ? requests.length : -1,
        options,
        requests: Array.isArray(requests)
          ? requests.map((request) => ({
            key: request.key,
            path: request.path,
            kind: request.kind,
            size: request.size
          }))
          : requests
      })
      try {
        const icons = await pluginSystem.getFileIcons(requests, options, traceContext)
        recordShowcaseSystemIpc('system.ipc:getFileIcons:done', caller, {
          webContentsId: traceContext.webContentsId,
          count: icons.length,
          icons: icons.filter((result) => Boolean(result.icon)).length
        })
        return icons
      } catch (error) {
        recordShowcaseSystemIpc('system.ipc:getFileIcons:error', caller, {
          webContentsId: traceContext.webContentsId,
          error
        })
        throw error
      }
    }
  )

  ipcMain.handle('system:clearFileIconCache', () => {
    pluginSystem.clearFileIconCache()
    return true
  })

  // 获取设备唯一标识 (新增)
  ipcMain.handle('system:getNativeId', () => {
    return pluginSystem.getNativeId()
  })

  // 判断是否开发环境 (新增)
  ipcMain.handle('system:isDev', () => {
    return pluginSystem.isDev()
  })

  // 平台判断 (新增)
  ipcMain.handle('system:isMacOS', () => {
    return pluginSystem.isMacOS()
  })

  ipcMain.handle('system:isWindows', () => {
    return pluginSystem.isWindows()
  })

  ipcMain.handle('system:isLinux', () => {
    return pluginSystem.isLinux()
  })
}
