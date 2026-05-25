import { ipcMain } from 'electron'
import { pluginShell } from '../plugin/shell'
import { commandRunnerService } from '../services/command-runner'
import { resolveIpcCallerSource } from '../services/ipc-caller-resolver'
import { resolveDirectCommandExecutionPermission } from '../plugin/command-execution-permissions'
import type { PluginPermissions } from '../../shared/types/plugin'

/**
 * 插件管理器查找函数（延迟注入，避免循环依赖）
 * 由 registerShellHandlers 的调用者通过 setPluginLookup 注入
 */
interface PluginLookupResult {
  manifest: {
    permissions?: PluginPermissions
  }
}

let pluginLookup: ((pluginId: string) => PluginLookupResult | undefined) | null = null

export function setShellPluginLookup(
  lookup: (pluginId: string) => PluginLookupResult | undefined
): void {
  pluginLookup = lookup
}

export function registerShellHandlers() {
  // 打开文件
  ipcMain.handle('shell:openPath', async (_, path: string) => {
    return pluginShell.openPath(path)
  })

  // 打开 URL
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    return pluginShell.openExternal(url)
  })

  // 在文件管理器中显示
  ipcMain.handle('shell:showItemInFolder', (_, path: string) => {
    pluginShell.showItemInFolder(path)
  })

  // 打开文件夹
  ipcMain.handle('shell:openFolder', async (_, path: string) => {
    return pluginShell.openFolder(path)
  })

  // 移动到回收站
  ipcMain.handle('shell:trashItem', async (_, path: string) => {
    return pluginShell.trashItem(path)
  })

  // 播放提示音
  ipcMain.handle('shell:beep', () => {
    pluginShell.beep()
  })

  // 命令执行 — 根据调用方来源自动分发权限
  ipcMain.handle('shell:runCommand', async (event, input) => {
    const caller = resolveIpcCallerSource(event.sender)

    if (caller.source === 'plugin' && caller.pluginId) {
      // 插件来源：检查 manifest permissions
      const plugin = pluginLookup?.(caller.pluginId)
      const commandPermission = resolveDirectCommandExecutionPermission(plugin?.manifest.permissions)
      const envKeys = plugin?.manifest.permissions?.envKeys
      return await commandRunnerService.runCommand(input, {
        source: 'plugin',
        pluginId: caller.pluginId,
        runCommandAllowed: commandPermission.allowed,
        envKeys,
        defaultProfile: commandPermission.defaultProfile,
        maxProfile: commandPermission.maxProfile,
        caller: {
          kind: 'plugin',
          host: 'plugin',
          actor: 'system',
          pluginId: caller.pluginId
        }
      })
    }

    if (caller.source === 'app') {
      // 主应用来源
      return await commandRunnerService.runCommand(input, {
        source: 'app',
        caller: {
          kind: 'app',
          host: 'app',
          actor: 'human'
        }
      })
    }

    throw new Error(`拒绝 IPC 越权调用，拦截未知发送方 (${caller.source}) 执行高风险系统命令`)
  })

  ipcMain.handle('shell:getRunCommandPolicy', (event) => {
    // 策略查询：仅主应用可访问
    const caller = resolveIpcCallerSource(event.sender)
    if (caller.source !== 'app') {
      throw new Error('仅主应用可查询命令执行策略')
    }
    return commandRunnerService.getPolicy()
  })

  ipcMain.handle('shell:updateRunCommandPolicy', (event, patch) => {
    // 策略修改：仅主应用可修改
    const caller = resolveIpcCallerSource(event.sender)
    if (caller.source !== 'app') {
      throw new Error('仅主应用可修改命令执行策略')
    }
    return commandRunnerService.updatePolicy(patch || {})
  })

  ipcMain.handle('shell:listRunCommandAudit', (event, limit?: number) => {
    const caller = resolveIpcCallerSource(event.sender)
    if (caller.source !== 'app') {
      throw new Error('仅主应用可查看命令执行审计日志')
    }
    return commandRunnerService.listAudit(limit)
  })

  ipcMain.handle('shell:clearRunCommandAudit', (event) => {
    const caller = resolveIpcCallerSource(event.sender)
    if (caller.source !== 'app') {
      throw new Error('仅主应用可清除命令执行审计日志')
    }
    return commandRunnerService.clearAudit()
  })

  ipcMain.handle('shell:clearRunCommandTrusted', (event) => {
    const caller = resolveIpcCallerSource(event.sender)
    if (caller.source !== 'app') {
      throw new Error('仅主应用可清除命令信任记录')
    }
    return commandRunnerService.clearTrustedFingerprints()
  })
}
