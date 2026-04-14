import type { IpcRenderer } from 'electron'
import type { InputPayload } from '../../shared/types/plugin'
import type { OpenSystemPluginPayload, SystemPluginBeforeAttachPayload } from '../../shared/types/electron'
import type { TaskSchedulerEvent } from '../../shared/types/task'

export function createAppPluginApi(ipcRenderer: IpcRenderer) {
  return {
    app: {
      onOpenSystemPlugin: (callback: (payload: OpenSystemPluginPayload) => void) => {
        const listener = (_event: unknown, payload: OpenSystemPluginPayload) => callback(payload)
        ipcRenderer.on('app:openSystemPlugin', listener)
        return () => ipcRenderer.removeListener('app:openSystemPlugin', listener)
      },
      onSystemPluginBeforeAttach: (callback: (payload: SystemPluginBeforeAttachPayload) => void | Promise<void>) => {
        const listener = (_event: unknown, payload: SystemPluginBeforeAttachPayload) => {
          void callback(payload)
        }
        ipcRenderer.on('app:systemPluginBeforeAttach', listener)
        return () => ipcRenderer.removeListener('app:systemPluginBeforeAttach', listener)
      },
      onOpenAiSettings: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('app:openAiSettings', listener)
        return () => ipcRenderer.removeListener('app:openAiSettings', listener)
      },
      onOpenAiMcpSettings: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('app:openAiMcpSettings', listener)
        return () => ipcRenderer.removeListener('app:openAiMcpSettings', listener)
      },
      onOpenAiToolsSettings: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('app:openAiToolsSettings', listener)
        return () => ipcRenderer.removeListener('app:openAiToolsSettings', listener)
      },
      onOpenAiSkillsSettings: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('app:openAiSkillsSettings', listener)
        return () => ipcRenderer.removeListener('app:openAiSkillsSettings', listener)
      },
      onOpenPluginStore: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('app:openPluginStore', listener)
        return () => ipcRenderer.removeListener('app:openPluginStore', listener)
      },
      onOpenPluginManager: (callback: (pluginId?: string) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, pluginId?: string) => callback(pluginId)
        ipcRenderer.on('app:openPluginManager', listener)
        return () => ipcRenderer.removeListener('app:openPluginManager', listener)
      },
      onOpenBackgroundPlugins: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('app:openBackgroundPlugins', listener)
        return () => ipcRenderer.removeListener('app:openBackgroundPlugins', listener)
      },
      onOpenTaskScheduler: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('app:openTaskScheduler', listener)
        return () => ipcRenderer.removeListener('app:openTaskScheduler', listener)
      },
      onOpenLogViewer: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('app:openLogViewer', listener)
        return () => ipcRenderer.removeListener('app:openLogViewer', listener)
      },
      onOpenStorageExplorer: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('app:openStorageExplorer', listener)
        return () => ipcRenderer.removeListener('app:openStorageExplorer', listener)
      },
      onOpenCommandShortcuts: (callback: (payload?: { cmdLabel?: string }) => void) => {
        const listener = (_event: unknown, payload?: { cmdLabel?: string }) => callback(payload)
        ipcRenderer.on('app:openCommandShortcuts', listener)
        return () => ipcRenderer.removeListener('app:openCommandShortcuts', listener)
      }
    },

    systemPlugin: {
      setActive: (pluginId: string | null) => ipcRenderer.invoke('systemPlugin:setActive', pluginId),
      notifyReadyForAttach: (requestId: string) => ipcRenderer.invoke('systemPlugin:notifyReadyForAttach', requestId),
      getActive: () => ipcRenderer.invoke('systemPlugin:getActive')
    },

    systemPage: {
      open: (payload: {
        page: 'settings' | 'plugin-manager' | 'plugin-store' | 'background-plugins' | 'task-scheduler' | 'log-viewer' | 'storage-explorer' | 'ai-settings' | 'ai-mcp-settings' | 'ai-tools-settings' | 'ai-skills-settings'
        settingsSection?: 'general' | 'shortcuts' | 'commandQuickLaunch' | 'commandAll' | 'permissions' | 'security' | 'developer' | 'about'
        shortcutCommandHint?: string
      }) => ipcRenderer.invoke('systemPage:open', payload),
      close: () => ipcRenderer.invoke('systemPage:close'),
      detach: () => ipcRenderer.invoke('systemPage:detach'),
      reload: () => ipcRenderer.invoke('systemPage:reload'),
      getMode: () => ipcRenderer.invoke('systemPage:getMode'),
      getState: () => ipcRenderer.invoke('systemPage:getState'),
      onStateChange: (callback: (state: { open: boolean; mode: 'none' | 'attached' | 'detached'; page: string | null; title: string }) => void) => {
        const listener = (_event: unknown, state: { open: boolean; mode: 'none' | 'attached' | 'detached'; page: string | null; title: string }) => callback(state)
        ipcRenderer.on('systemPage:state', listener)
        return () => ipcRenderer.removeListener('systemPage:state', listener)
      }
    },

    plugin: {
      getAll: () => ipcRenderer.invoke('plugin:getAll'),
      listCommands: (pluginId?: string) => ipcRenderer.invoke('plugin:listCommands', pluginId),
      search: (query: string | InputPayload) => ipcRenderer.invoke('plugin:search', query),
      run: (name: string, featureCode: string, input?: string | InputPayload) =>
        ipcRenderer.invoke('plugin:run', name, featureCode, input),
      runCommand: (input: unknown) => ipcRenderer.invoke('plugin:runCommand', input),
      getRecentUsed: (limit?: number) => ipcRenderer.invoke('plugin:getRecentUsed', limit),
      // 搜索偏好管理
      getSearchPreferences: () => ipcRenderer.invoke('plugin:getSearchPreferences'),
      pinFeature: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:pinFeature', pluginId, featureCode),
      unpinFeature: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:unpinFeature', pluginId, featureCode),
      hideFeature: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:hideFeature', pluginId, featureCode),
      unhideFeature: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:unhideFeature', pluginId, featureCode),
      removeRecentUsage: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:removeRecentUsage', pluginId, featureCode),
      install: (filePath: string) => ipcRenderer.invoke('plugin:install', filePath),
      enable: (name: string) => ipcRenderer.invoke('plugin:enable', name),
      disable: (name: string) => ipcRenderer.invoke('plugin:disable', name),
      uninstall: (name: string) => ipcRenderer.invoke('plugin:uninstall', name),
      getReadme: (name: string) => ipcRenderer.invoke('plugin:getReadme', name),
      listBackground: () => ipcRenderer.invoke('plugin:listBackground'),
      stopBackground: (pluginId: string) => ipcRenderer.invoke('plugin:stopBackground', pluginId),
      getBackgroundInfo: (pluginId: string) => ipcRenderer.invoke('plugin:getBackgroundInfo', pluginId),
      startBackground: (pluginId: string) => ipcRenderer.invoke('plugin:startBackground', pluginId),
      stopPlugin: (pluginId: string) => ipcRenderer.invoke('plugin:stopPlugin', pluginId),
      listCommandShortcuts: (pluginId?: string) => ipcRenderer.invoke('plugin:commandShortcut:list', pluginId),
      bindCommandShortcut: (input: unknown) => ipcRenderer.invoke('plugin:commandShortcut:bind', input),
      unbindCommandShortcut: (bindingId: string) => ipcRenderer.invoke('plugin:commandShortcut:unbind', bindingId),
      validateCommandShortcut: (accelerator: string, bindingId?: string) =>
        ipcRenderer.invoke('plugin:commandShortcut:validate', accelerator, bindingId),
      setCommandDisabled: (input: unknown) => ipcRenderer.invoke('plugin:command:setDisabled', input),
      redirect: (label: string | [string, string], payload?: unknown) =>
        ipcRenderer.invoke('plugin:redirect', label, payload),
      outPlugin: (isKill?: boolean) => ipcRenderer.invoke('plugin:out', isKill)
    },

    pluginStore: {
      fetch: () => ipcRenderer.invoke('plugin:store:fetch'),
      installFromUrl: (input: unknown) => ipcRenderer.invoke('plugin:store:installFromUrl', input),
      checkUpdatesInstalled: () => ipcRenderer.invoke('plugin:store:checkUpdatesInstalled'),
      updateAll: (pluginIds?: string[]) => ipcRenderer.invoke('plugin:store:updateAll', pluginIds)
    },

    scheduler: {
      listTasks: (filter?: { pluginId?: string; status?: string; type?: string; limit?: number; offset?: number }) =>
        ipcRenderer.invoke('scheduler:listTasks', filter),
      getTaskCount: (filter?: { pluginId?: string; status?: string; type?: string }) =>
        ipcRenderer.invoke('scheduler:getTaskCount', filter),
      getTask: (taskId: string) => ipcRenderer.invoke('scheduler:getTask', taskId),
      schedule: (task: unknown) => ipcRenderer.invoke('scheduler:schedule', task),
      cancelTask: (taskId: string) => ipcRenderer.invoke('scheduler:cancelTask', taskId),
      pauseTask: (taskId: string) => ipcRenderer.invoke('scheduler:pauseTask', taskId),
      resumeTask: (taskId: string) => ipcRenderer.invoke('scheduler:resumeTask', taskId),
      deleteTasks: (taskIds: string[]) => ipcRenderer.invoke('scheduler:deleteTasks', taskIds),
      cleanupTasks: (olderThan?: number) => ipcRenderer.invoke('scheduler:cleanupTasks', olderThan),
      getExecutions: (taskId: string, limit?: number) =>
        ipcRenderer.invoke('scheduler:getExecutions', taskId, limit),
      validateCron: (expression: string) => ipcRenderer.invoke('scheduler:validateCron', expression),
      getNextCronTime: (expression: string, after?: Date) =>
        ipcRenderer.invoke('scheduler:getNextCronTime', expression, after),
      describeCron: (expression: string) => ipcRenderer.invoke('scheduler:describeCron', expression),
      subscribe: () => ipcRenderer.invoke('scheduler:subscribe'),
      unsubscribe: () => ipcRenderer.invoke('scheduler:unsubscribe'),
      onEvent: (callback: (event: TaskSchedulerEvent) => void) => {
        const listener = (_event: unknown, event: TaskSchedulerEvent) => callback(event)
        ipcRenderer.on('scheduler:event', listener)
        return () => ipcRenderer.removeListener('scheduler:event', listener)
      }
    },

    onPluginInit: (() => {
      // Buffer: eagerly listen for plugin:init so late-registering listeners
      // (e.g. React useEffect) don't miss the event.
      let bufferedData: any = null
      ipcRenderer.on('plugin:init', (_event: unknown, data: any) => {
        bufferedData = data
      })
      return (callback: (data: { pluginName: string; featureCode: string; input: string; mode?: string }) => void) => {
        const listener = (_event: unknown, data: any) => callback(data)
        ipcRenderer.on('plugin:init', listener)
        // Replay buffered data for late listeners (fixes race with React useEffect)
        if (bufferedData) {
          const data = bufferedData
          queueMicrotask(() => callback(data))
        }
        return () => ipcRenderer.removeListener('plugin:init', listener)
      }
    })(),

    onPluginAttach: (callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string; preloadPath: string }) => void) => {
      const listener = (_event: unknown, data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string; preloadPath: string }) => callback(data)
      ipcRenderer.on('plugin:attach', listener)
      return () => ipcRenderer.removeListener('plugin:attach', listener)
    },

    onPluginDetached: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('plugin:detached', listener)
      return () => ipcRenderer.removeListener('plugin:detached', listener)
    },

    host: {
      invoke: (pluginName: string, method: string, ...args: unknown[]) =>
        ipcRenderer.invoke('host:invoke', pluginName, method, ...args),
      call: (pluginName: string, method: string, ...args: unknown[]) =>
        ipcRenderer.invoke('host:call', pluginName, method, ...args),
      status: (pluginName: string) =>
        ipcRenderer.invoke('host:status', pluginName),
      restart: (pluginName: string) =>
        ipcRenderer.invoke('host:restart', pluginName)
    }
  }
}
