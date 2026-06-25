import { webUtils, type IpcRenderer } from 'electron'
import { formatPayloadTrace } from '../../shared/attachment-trace'
import type {
  InputPayload,
  PluginDirectoryAccessRequestInput,
  PluginRendererCapabilities
} from '../../shared/types/plugin'
import type {
  MainWindowShowEvent,
  OpenSystemPluginPayload,
  PluginLaunchEndEvent,
  PluginLaunchStartEvent,
  SystemPluginBeforeAttachPayload
} from '../../shared/types/electron'
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
      onOpenPluginStore: (callback: (filter?: 'updatable') => void) => {
        const listener = (_event: Electron.IpcRendererEvent, filter?: 'updatable') => callback(filter)
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
      },
      onSetSearchText: (callback: (query: string) => void) => {
        const listener = (_event: unknown, query: string) => callback(query)
        ipcRenderer.on('app:setSearchText', listener)
        return () => ipcRenderer.removeListener('app:setSearchText', listener)
      },
      onMainWindowShow: (callback: (event: MainWindowShowEvent) => void) => {
        const listener = (_event: unknown, payload: MainWindowShowEvent) => callback(payload)
        ipcRenderer.on('app:mainWindowShow', listener)
        return () => ipcRenderer.removeListener('app:mainWindowShow', listener)
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
        detailsPluginId?: string
        storeFilter?: 'updatable'
      }) => ipcRenderer.invoke('systemPage:open', payload),
      close: () => ipcRenderer.invoke('systemPage:close'),
      detach: () => ipcRenderer.invoke('systemPage:detach'),
      reload: () => ipcRenderer.invoke('systemPage:reload'),
      showMenu: (point?: { x: number; y: number }) => ipcRenderer.invoke('systemPage:showMenu', point),
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
      run: (name: string, featureCode: string, input?: string | InputPayload, launchStart?: number) =>
        ipcRenderer.invoke('plugin:run', name, featureCode, input, launchStart),
      prewarm: (pluginId: string) => ipcRenderer.invoke('plugin:prewarm', pluginId),
      prewarmUi: (pluginId: string, featureCode?: string, route?: string) =>
        ipcRenderer.invoke('plugin:prewarmUi', pluginId, featureCode, route),
      runCommand: (input: unknown) => ipcRenderer.invoke('plugin:runCommand', input),
      getRecentUsed: (limit?: number) => ipcRenderer.invoke('plugin:getRecentUsed', limit),
      // 搜索偏好管理
      getSearchPreferences: () => ipcRenderer.invoke('plugin:getSearchPreferences'),
      pinFeature: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:pinFeature', pluginId, featureCode),
      unpinFeature: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:unpinFeature', pluginId, featureCode),
      hideFeature: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:hideFeature', pluginId, featureCode),
      unhideFeature: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:unhideFeature', pluginId, featureCode),
      removeRecentUsage: (pluginId: string, featureCode: string) => ipcRenderer.invoke('plugin:removeRecentUsage', pluginId, featureCode),
      getLaunchOnStartup: (pluginId: string) => ipcRenderer.invoke('plugin:getLaunchOnStartup', pluginId),
      setLaunchOnStartup: (
        pluginId: string,
        enabled: boolean,
        target?: { featureCode?: string; route?: string; mode?: 'normal' | 'attached' | 'detached' | 'background'; uiMode?: 'attached' | 'detached' }
      ) => ipcRenderer.invoke('plugin:setLaunchOnStartup', pluginId, enabled, target),
      getAlwaysOpenDetached: (pluginId: string) => ipcRenderer.invoke('plugin:getAlwaysOpenDetached', pluginId),
      setAlwaysOpenDetached: (pluginId: string, enabled: boolean) =>
        ipcRenderer.invoke('plugin:setAlwaysOpenDetached', pluginId, enabled),
      resolveDroppedFilePaths: (files: File[]) => files.map((file) => {
        try {
          return webUtils.getPathForFile(file)
        } catch {
          return ''
        }
      }),
      install: (filePath: string) => ipcRenderer.invoke('plugin:install', filePath),
      enable: (name: string) => ipcRenderer.invoke('plugin:enable', name),
      disable: (name: string) => ipcRenderer.invoke('plugin:disable', name),
      uninstall: (name: string, options?: { purgeData?: boolean }) => ipcRenderer.invoke('plugin:uninstall', name, options),
      getDataStats: (name: string) => ipcRenderer.invoke('plugin:getDataStats', name),
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
      outPlugin: (isKill?: boolean) => ipcRenderer.invoke('plugin:out', isKill),
      mainPushSelect: (pluginName: string, action: { code: string; type: string; payload: string; option: unknown }) =>
        ipcRenderer.invoke('plugin:mainPushSelect', pluginName, action),
      getMainPushPlugins: () => ipcRenderer.invoke('plugin:getMainPushPlugins')
    },

    pluginStore: {
      fetch: () => ipcRenderer.invoke('plugin:store:fetch'),
      installFromUrl: (input: unknown) => ipcRenderer.invoke('plugin:store:installFromUrl', input),
      checkUpdatesInstalled: () => ipcRenderer.invoke('plugin:store:checkUpdatesInstalled'),
      updateAll: (pluginIds?: string[]) => ipcRenderer.invoke('plugin:store:updateAll', pluginIds)
    },

    directoryAccess: {
      request: (input?: PluginDirectoryAccessRequestInput) => ipcRenderer.invoke('directoryAccess:request', input),
      list: () => ipcRenderer.invoke('directoryAccess:list'),
      revoke: (grantIdOrPath: string) => ipcRenderer.invoke('directoryAccess:revoke', grantIdOrPath)
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
      type PluginInitData = {
        pluginName: string
        featureCode: string
        input: string
        attachments?: InputPayload['attachments']
        mode?: string
        capabilities?: PluginRendererCapabilities
        nonce?: number
        route?: string
        params?: Record<string, string>
        windowType?: string
      }
      let bufferedData: PluginInitData | null = null
      ipcRenderer.on('plugin:init', (_event: unknown, data: PluginInitData) => {
        console.log(`[AttachmentTrace][Preload] plugin:init received | plugin=${data?.pluginName} | feature=${data?.featureCode} | nonce=${data?.nonce ?? 'none'} | ${formatPayloadTrace({ text: data?.input || '', attachments: data?.attachments || [] })}`)
        bufferedData = data
      })
      return (callback: (data: PluginInitData) => void) => {
        const listener = (_event: unknown, data: PluginInitData) => {
          console.log(`[AttachmentTrace][Preload] plugin:init callback | plugin=${data?.pluginName} | feature=${data?.featureCode} | nonce=${data?.nonce ?? 'none'} | ${formatPayloadTrace({ text: data?.input || '', attachments: data?.attachments || [] })}`)
          callback(data)
        }
        ipcRenderer.on('plugin:init', listener)
        // Replay buffered data for late listeners (fixes race with React useEffect)
        if (bufferedData) {
          const data = bufferedData
          console.log(`[AttachmentTrace][Preload] replay buffered plugin:init | plugin=${data?.pluginName} | feature=${data?.featureCode} | nonce=${data?.nonce ?? 'none'} | ${formatPayloadTrace({ text: data?.input || '', attachments: data?.attachments || [] })}`)
          queueMicrotask(() => callback(data))
        }
        return () => ipcRenderer.removeListener('plugin:init', listener)
      }
    })(),

    onPluginAttach: (callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; attachments?: InputPayload['attachments']; mode: 'panel'; launchRequestId?: string }) => void) => {
      const listener = (_event: unknown, data: { pluginName: string; displayName: string; featureCode: string; input: string; attachments?: InputPayload['attachments']; mode: 'panel'; launchRequestId?: string }) => callback(data)
      ipcRenderer.on('plugin:attach', listener)
      return () => ipcRenderer.removeListener('plugin:attach', listener)
    },

    onPluginDetached: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('plugin:detached', listener)
      return () => ipcRenderer.removeListener('plugin:detached', listener)
    },

    // 插件窗口模式切换（附着面板 <-> 独立窗口）。区别于会重置状态的 plugin:init：
    // 该事件只通知模式变化，不携带 input/route，插件可据此调整布局/标题栏而不丢状态。
    onModeChange: (callback: (data: { mode: 'attached' | 'detached'; windowType?: string; pluginName?: string }) => void) => {
      const listener = (_event: unknown, data: { mode: 'attached' | 'detached'; windowType?: string; pluginName?: string }) => callback(data)
      ipcRenderer.on('plugin:mode-changed', listener)
      return () => ipcRenderer.removeListener('plugin:mode-changed', listener)
    },

    onPluginOut: (callback: (isKill: boolean) => void) => {
      const listener = (_event: unknown, isKill: boolean) => callback(isKill)
      ipcRenderer.on('plugin:out', listener)
      return () => ipcRenderer.removeListener('plugin:out', listener)
    },

    onPluginLaunchStart: (callback: (data: PluginLaunchStartEvent) => void) => {
      const listener = (_event: unknown, data: PluginLaunchStartEvent) => callback(data)
      ipcRenderer.on('plugin:launch-start', listener)
      return () => ipcRenderer.removeListener('plugin:launch-start', listener)
    },

    onPluginLaunchEnd: (callback: (data: PluginLaunchEndEvent) => void) => {
      const listener = (_event: unknown, data: PluginLaunchEndEvent) => callback(data)
      ipcRenderer.on('plugin:launch-end', listener)
      return () => ipcRenderer.removeListener('plugin:launch-end', listener)
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
