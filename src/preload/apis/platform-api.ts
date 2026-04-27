import type { IpcRenderer } from 'electron'

/**
 * 创建平台 API
 *
 * @param ipcRenderer Electron IPC 渲染进程端
 * @param options.restricted 受限模式（插件窗口），不暴露 runCommand 和策略管理 API
 */
export function createPlatformApi(ipcRenderer: IpcRenderer, options?: { restricted?: boolean }) {
  const restricted = options?.restricted ?? false



  return {
    screen: {
      getAllDisplays: () => ipcRenderer.invoke('screen:getAllDisplays'),
      getPrimaryDisplay: () => ipcRenderer.invoke('screen:getPrimaryDisplay'),
      getDisplayNearestPoint: (point: { x: number; y: number }) =>
        ipcRenderer.invoke('screen:getDisplayNearestPoint', point),
      getDisplayMatching: (rect: { x: number; y: number; width: number; height: number }) =>
        ipcRenderer.invoke('screen:getDisplayMatching', rect),
      getCursorScreenPoint: () => ipcRenderer.invoke('screen:getCursorScreenPoint'),
      getSources: (options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }) =>
        ipcRenderer.invoke('screen:getSources', options),
      capture: (options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }) =>
        ipcRenderer.invoke('screen:capture', options),
      captureRegion: (
        region: { x: number; y: number; width: number; height: number },
        options?: { format?: 'png' | 'jpeg'; quality?: number }
      ) => ipcRenderer.invoke('screen:captureRegion', region, options),
      getMediaStreamConstraints: (options: { sourceId: string; audio?: boolean; frameRate?: number }) =>
        ipcRenderer.invoke('screen:getMediaStreamConstraints', options),
      screenCapture: () => ipcRenderer.invoke('screen:startRegionCapture'),
      colorPick: () => ipcRenderer.invoke('screen:colorPick')
    },

    shell: {
      openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
      openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
      showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
      openFolder: (path: string) => ipcRenderer.invoke('shell:openFolder', path),
      trashItem: (path: string) => ipcRenderer.invoke('shell:trashItem', path),
      beep: () => ipcRenderer.invoke('shell:beep'),
      
      runCommand: (input: unknown) => ipcRenderer.invoke('shell:runCommand', input),
      getRunCommandPolicy: () => restricted ? Promise.reject(new Error('API restricted')) : ipcRenderer.invoke('shell:getRunCommandPolicy'),
      updateRunCommandPolicy: (patch: unknown) => restricted ? Promise.reject(new Error('API restricted')) : ipcRenderer.invoke('shell:updateRunCommandPolicy', patch),
      listRunCommandAudit: (limit?: number) => restricted ? Promise.reject(new Error('API restricted')) : ipcRenderer.invoke('shell:listRunCommandAudit', limit),
      clearRunCommandAudit: () => restricted ? Promise.reject(new Error('API restricted')) : ipcRenderer.invoke('shell:clearRunCommandAudit'),
      clearRunCommandTrusted: () => restricted ? Promise.reject(new Error('API restricted')) : ipcRenderer.invoke('shell:clearRunCommandTrusted')
    },

    desktop: {
      searchFiles: (query: string, limit?: number) => ipcRenderer.invoke('desktop:searchFiles', query, limit),
      searchApps: (query: string, limit?: number) => ipcRenderer.invoke('desktop:searchApps', query, limit)
    },

    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') =>
        ipcRenderer.invoke('filesystem:readFile', path, encoding),
      writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') =>
        ipcRenderer.invoke('filesystem:writeFile', path, data, encoding),
      exists: (path: string) => ipcRenderer.invoke('filesystem:exists', path),
      readdir: (path: string) => ipcRenderer.invoke('filesystem:readdir', path),
      mkdir: (path: string) => ipcRenderer.invoke('filesystem:mkdir', path),
      stat: (path: string) => ipcRenderer.invoke('filesystem:stat', path),
      copy: (src: string, dest: string) => ipcRenderer.invoke('filesystem:copy', src, dest),
      move: (src: string, dest: string) => ipcRenderer.invoke('filesystem:move', src, dest),
      unlink: (path: string) => ipcRenderer.invoke('filesystem:unlink', path)
    },

    dialog: {
      showOpenDialog: (options?: {
        title?: string
        defaultPath?: string
        buttonLabel?: string
        filters?: { name: string; extensions: string[] }[]
        properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
      }) => ipcRenderer.invoke('dialog:showOpenDialog', options),
      showSaveDialog: (options?: {
        title?: string
        defaultPath?: string
        buttonLabel?: string
        filters?: { name: string; extensions: string[] }[]
      }) => ipcRenderer.invoke('dialog:showSaveDialog', options),
      showMessageBox: (options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title?: string
        message: string
        detail?: string
        buttons?: string[]
        defaultId?: number
        cancelId?: number
      }) => ipcRenderer.invoke('dialog:showMessageBox', options),
      showErrorBox: (title: string, content: string) =>
        ipcRenderer.invoke('dialog:showErrorBox', title, content)
    },

    system: {
      getSystemInfo: () => ipcRenderer.invoke('system:getSystemInfo'),
      getAppInfo: () => ipcRenderer.invoke('system:getAppInfo'),
      getAppResourceUsage: () => ipcRenderer.invoke('system:getAppResourceUsage'),
      getPath: (name: string) => ipcRenderer.invoke('system:getPath', name),
      getEnv: (name: string) => ipcRenderer.invoke('system:getEnv', name),
      getIdleTime: () => ipcRenderer.invoke('system:getIdleTime'),
      getFileIcon: (
        filePath: string,
        options?: { size?: number; kind?: 'app' | 'file' }
      ) => ipcRenderer.invoke('system:getFileIcon', filePath, options),
      getFileIcons: (
        requests: Array<{ key: string; path: string; kind?: 'app' | 'file'; size?: number }>,
        options?: { size?: number; concurrency?: number }
      ) => ipcRenderer.invoke('system:getFileIcons', requests, options),
      getNativeId: () => ipcRenderer.invoke('system:getNativeId'),
      isDev: () => ipcRenderer.invoke('system:isDev'),
      isMacOS: () => ipcRenderer.invoke('system:isMacOS'),
      isWindows: () => ipcRenderer.invoke('system:isWindows'),
      isLinux: () => ipcRenderer.invoke('system:isLinux')
    },

    permission: {
      getStatus: (type: string) => ipcRenderer.invoke('permission:getStatus', type),
      request: (type: string) => ipcRenderer.invoke('permission:request', type),
      canRequest: (type: string) => ipcRenderer.invoke('permission:canRequest', type),
      openSystemSettings: (type: string) => ipcRenderer.invoke('permission:openSystemSettings', type),
      isAccessibilityTrusted: () => ipcRenderer.invoke('permission:isAccessibilityTrusted')
    },

    shortcut: {
      register: (accelerator: string) => ipcRenderer.invoke('shortcut:register', accelerator),
      unregister: (accelerator: string) => ipcRenderer.invoke('shortcut:unregister', accelerator),
      unregisterAll: () => ipcRenderer.invoke('shortcut:unregisterAll'),
      isRegistered: (accelerator: string) => ipcRenderer.invoke('shortcut:isRegistered', accelerator),
      onTriggered: (callback: (accelerator: string) => void) => {
        const listener = (_event: unknown, accelerator: string) => callback(accelerator)
        ipcRenderer.on('shortcut:triggered', listener)
        return () => ipcRenderer.removeListener('shortcut:triggered', listener)
      }
    },

    security: {
      isEncryptionAvailable: () => ipcRenderer.invoke('security:isEncryptionAvailable'),
      encryptString: (plainText: string) => ipcRenderer.invoke('security:encryptString', plainText),
      decryptString: (encrypted: Buffer) => ipcRenderer.invoke('security:decryptString', encrypted)
    },

    storage: {
      get: (key: string, namespace?: string) => ipcRenderer.invoke('storage:get', key, namespace),
      set: (key: string, value: unknown, namespace?: string) => ipcRenderer.invoke('storage:set', key, value, namespace),
      remove: (key: string, namespace?: string) => ipcRenderer.invoke('storage:remove', key, namespace),
      getAll: (namespace?: string) => ipcRenderer.invoke('storage:getAll', namespace),
      getAllWithMeta: (namespace: string) => ipcRenderer.invoke('storage:getAllWithMeta', namespace),
      listNamespaces: () => ipcRenderer.invoke('storage:listNamespaces'),
      clear: (namespace: string) => ipcRenderer.invoke('storage:clear', namespace),
      // V2 扩展方法
      list: (options?: { prefix?: string; startsAfter?: string; limit?: number; order?: 'asc' | 'desc'; namespace?: string }) => {
        const ns = options?.namespace
        return ipcRenderer.invoke('storage:list', ns, options)
      },
      getMany: (keys: string[], options?: { namespace?: string }) =>
        ipcRenderer.invoke('storage:getMany', keys, options?.namespace),
      setMany: (items: { key: string; value: unknown; expectedVersion?: number | null }[], options?: { namespace?: string; atomic?: boolean }) =>
        ipcRenderer.invoke('storage:setMany', items, options, options?.namespace),
      getMeta: (key: string, options?: { namespace?: string }) =>
        ipcRenderer.invoke('storage:getMeta', key, options?.namespace),
      setWithVersion: (key: string, value: unknown, options?: { namespace?: string; expectedVersion?: number | null }) =>
        ipcRenderer.invoke('storage:setWithVersion', key, value, options?.expectedVersion, options?.namespace),
      removeWithVersion: (key: string, options?: { namespace?: string; expectedVersion?: number }) =>
        ipcRenderer.invoke('storage:removeWithVersion', key, options?.expectedVersion, options?.namespace),
      transaction: (ops: { op: 'set' | 'remove'; key: string; value?: unknown; expectedVersion?: number | null }[], options?: { namespace?: string }) =>
        ipcRenderer.invoke('storage:transaction', ops, options?.namespace),
      append: (key: string, chunk: unknown, options?: { namespace?: string; maxItems?: number }) =>
        ipcRenderer.invoke('storage:append', key, chunk, options, options?.namespace),
      watch: (options: { namespace?: string; prefix?: string }, callback: (event: { type: 'set' | 'remove' | 'clear'; key: string; namespace: string; version?: number; updatedAt: number }) => void) => {
        let watchId: number | null = null
        ipcRenderer.invoke('storage:watch', options).then((id: number) => { watchId = id })
        const listener = (_event: unknown, watchEvent: { type: 'set' | 'remove' | 'clear'; key: string; namespace: string; version?: number; updatedAt: number }) => callback(watchEvent)
        ipcRenderer.on('storage:change', listener)
        return () => {
          if (watchId !== null) ipcRenderer.invoke('storage:unwatch', watchId)
          ipcRenderer.removeListener('storage:change', listener)
        }
      }
    },

    settings: {
      get: () => ipcRenderer.invoke('settings:get'),
      update: (partial: unknown) => ipcRenderer.invoke('settings:update', partial),
      reset: () => ipcRenderer.invoke('settings:reset'),
      pauseShortcuts: () => ipcRenderer.invoke('settings:shortcuts:pause'),
      resumeShortcuts: () => ipcRenderer.invoke('settings:shortcuts:resume'),
      setShortcutRecordingActive: (active: boolean) => ipcRenderer.invoke('settings:shortcuts:recording:setActive', active),
      onShortcutCaptured: (callback: (accelerator: string) => void) => {
        const listener = (_event: unknown, accelerator: string) => callback(accelerator)
        ipcRenderer.on('settings:shortcut:captured', listener)
        return () => ipcRenderer.removeListener('settings:shortcut:captured', listener)
      },
      getOpenAtLoginState: () => ipcRenderer.invoke('settings:startup:getOpenAtLogin'),
      setOpenAtLogin: (enabled: boolean) => ipcRenderer.invoke('settings:startup:setOpenAtLogin', enabled),
      getUpdateCenterState: () => ipcRenderer.invoke('settings:updateCenter:getState'),
      checkAppUpdates: () => ipcRenderer.invoke('settings:updateCenter:check'),
      openUpdateReleasePage: () => ipcRenderer.invoke('settings:updateCenter:openReleasePage'),
      downloadUpdate: () => ipcRenderer.invoke('settings:updateCenter:downloadUpdate'),
      installUpdate: () => ipcRenderer.invoke('settings:updateCenter:installUpdate'),
      onUpdateStateChanged: (callback: (state: unknown) => void) => {
        const listener = (_event: unknown, state: unknown) => callback(state)
        ipcRenderer.on('updateCenter:stateChanged', listener)
        return () => ipcRenderer.removeListener('updateCenter:stateChanged', listener)
      },
      onShortcutStatusChanged: (callback: (status: unknown) => void) => {
        const listener = (_event: unknown, status: unknown) => callback(status)
        ipcRenderer.on('settings:shortcutStatus:changed', listener)
        return () => ipcRenderer.removeListener('settings:shortcutStatus:changed', listener)
      }
    },

    developer: {
      addPluginPath: (path: string) => ipcRenderer.invoke('developer:addPluginPath', path),
      removePluginPath: (path: string) => ipcRenderer.invoke('developer:removePluginPath', path),
      reloadPlugins: () => ipcRenderer.invoke('developer:reloadPlugins'),
      selectDirectory: () => ipcRenderer.invoke('developer:selectDirectory')
    },

    media: {
      getAccessStatus: (mediaType: 'microphone' | 'camera') =>
        ipcRenderer.invoke('media:getAccessStatus', mediaType),
      askForAccess: (mediaType: 'microphone' | 'camera') =>
        ipcRenderer.invoke('media:askForAccess', mediaType),
      hasCameraAccess: () => ipcRenderer.invoke('media:hasCameraAccess'),
      hasMicrophoneAccess: () => ipcRenderer.invoke('media:hasMicrophoneAccess')
    },

    power: {
      getSystemIdleTime: () => ipcRenderer.invoke('power:getSystemIdleTime'),
      getSystemIdleState: (idleThreshold: number) =>
        ipcRenderer.invoke('power:getSystemIdleState', idleThreshold),
      isOnBatteryPower: () => ipcRenderer.invoke('power:isOnBatteryPower'),
      getCurrentThermalState: () => ipcRenderer.invoke('power:getCurrentThermalState'),
      onSuspend: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('power:suspend', listener)
        return () => ipcRenderer.removeListener('power:suspend', listener)
      },
      onResume: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('power:resume', listener)
        return () => ipcRenderer.removeListener('power:resume', listener)
      },
      onAC: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('power:on-ac', listener)
        return () => ipcRenderer.removeListener('power:on-ac', listener)
      },
      onBattery: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('power:on-battery', listener)
        return () => ipcRenderer.removeListener('power:on-battery', listener)
      },
      onLockScreen: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('power:lock-screen', listener)
        return () => ipcRenderer.removeListener('power:lock-screen', listener)
      },
      onUnlockScreen: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('power:unlock-screen', listener)
        return () => ipcRenderer.removeListener('power:unlock-screen', listener)
      }
    },

    tray: {
      create: (options: { icon: string; tooltip?: string; title?: string }) =>
        ipcRenderer.invoke('tray:create', options),
      destroy: () => ipcRenderer.invoke('tray:destroy'),
      setIcon: (icon: string) => ipcRenderer.invoke('tray:setIcon', icon),
      setTooltip: (tooltip: string) => ipcRenderer.invoke('tray:setTooltip', tooltip),
      setTitle: (title: string) => ipcRenderer.invoke('tray:setTitle', title),
      exists: () => ipcRenderer.invoke('tray:exists')
    },

    trayMenu: {
      getState: () => ipcRenderer.invoke('tray-menu:getState'),
      action: (action: string, payload?: Record<string, unknown>) => ipcRenderer.invoke('tray-menu:action', action, payload),
      close: () => ipcRenderer.invoke('tray-menu:close'),
      onState: (callback: (state: unknown) => void) => {
        const listener = (_event: unknown, state: unknown) => callback(state)
        ipcRenderer.on('tray-menu:state', listener)
        return () => ipcRenderer.removeListener('tray-menu:state', listener)
      }
    },

    superPanel: {
      getState: () => ipcRenderer.invoke('super-panel:getState'),
      action: (action: string, payload?: Record<string, unknown>) => ipcRenderer.invoke('super-panel:action', action, payload),
      close: () => ipcRenderer.invoke('super-panel:close'),
      setIgnoreBlur: (ignore: boolean) => ipcRenderer.invoke('super-panel:setIgnoreBlur', ignore),
      onState: (callback: (state: unknown) => void) => {
        const listener = (_event: unknown, state: unknown) => callback(state)
        ipcRenderer.on('super-panel:state', listener)
        return () => ipcRenderer.removeListener('super-panel:state', listener)
      }
    },

    http: {
      request: (options: unknown) => ipcRenderer.invoke('http:request', options),
      get: (url: string, headers?: Record<string, string>) => ipcRenderer.invoke('http:get', url, headers),
      post: (url: string, body?: unknown, headers?: Record<string, string>) => ipcRenderer.invoke('http:post', url, body, headers),
      put: (url: string, body?: unknown, headers?: Record<string, string>) => ipcRenderer.invoke('http:put', url, body, headers),
      delete: (url: string, headers?: Record<string, string>) => ipcRenderer.invoke('http:delete', url, headers)
    },

    network: {
      isOnline: () => ipcRenderer.invoke('network:isOnline'),
      onOnline: (callback: () => void) => {
        window.addEventListener('online', callback)
      },
      onOffline: (callback: () => void) => {
        window.addEventListener('offline', callback)
      }
    },

    menu: {
      showContextMenu: (items: {
        label: string
        type?: 'normal' | 'separator' | 'checkbox' | 'radio'
        checked?: boolean
        enabled?: boolean
        id?: string
        submenu?: Array<Record<string, unknown>>
      }[]) => ipcRenderer.invoke('menu:showContextMenu', items)
    },

    geolocation: {
      getAccessStatus: () => ipcRenderer.invoke('geolocation:getAccessStatus'),
      requestAccess: () => ipcRenderer.invoke('geolocation:requestAccess'),
      canGetPosition: () => ipcRenderer.invoke('geolocation:canGetPosition'),
      openSettings: () => ipcRenderer.invoke('geolocation:openSettings'),
      getCurrentPosition: () => {
        console.log('[Geolocation] getCurrentPosition called (using IPC)')
        return ipcRenderer.invoke('geolocation:getCurrentPosition')
      }
    },

    tts: {
      speak: (text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }) => {
        return new Promise<void>((resolve, reject) => {
          const utterance = new SpeechSynthesisUtterance(text)
          if (options?.lang) utterance.lang = options.lang
          if (options?.rate) utterance.rate = options.rate
          if (options?.pitch) utterance.pitch = options.pitch
          if (options?.volume) utterance.volume = options.volume
          utterance.onend = () => resolve()
          utterance.onerror = (e) => reject(e)
          speechSynthesis.speak(utterance)
        })
      },
      stop: () => speechSynthesis.cancel(),
      pause: () => speechSynthesis.pause(),
      resume: () => speechSynthesis.resume(),
      getVoices: () => speechSynthesis.getVoices().map(v => ({
        name: v.name,
        lang: v.lang,
        default: v.default,
        localService: v.localService
      })),
      isSpeaking: () => speechSynthesis.speaking
    },

    openclaw: {
      getSettings: () => ipcRenderer.invoke('openclaw:getSettings'),
      updateSettings: (partial: unknown) => ipcRenderer.invoke('openclaw:updateSettings', partial),
      connect: () => ipcRenderer.invoke('openclaw:connect'),
      disconnect: () => ipcRenderer.invoke('openclaw:disconnect'),
      getStatus: () => ipcRenderer.invoke('openclaw:getStatus'),
      testConnection: (settings: unknown) => ipcRenderer.invoke('openclaw:testConnection', settings),
      onStatusChanged: (callback: (status: unknown) => void) => {
        const listener = (_event: unknown, status: unknown) => callback(status)
        ipcRenderer.on('openclaw:statusChanged', listener)
        return () => ipcRenderer.removeListener('openclaw:statusChanged', listener)
      },
      onInvoked: (callback: (data: unknown) => void) => {
        const listener = (_event: unknown, data: unknown) => callback(data)
        ipcRenderer.on('openclaw:invoked', listener)
        return () => ipcRenderer.removeListener('openclaw:invoked', listener)
      },
      getLogs: () => ipcRenderer.invoke('openclaw:getLogs'),
      clearLogs: () => ipcRenderer.invoke('openclaw:clearLogs'),
      onLog: (callback: (entry: unknown) => void) => {
        const listener = (_event: unknown, entry: unknown) => callback(entry)
        ipcRenderer.on('openclaw:log', listener)
        return () => ipcRenderer.removeListener('openclaw:log', listener)
      },
      onLogsCleared: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('openclaw:logsCleared', listener)
        return () => ipcRenderer.removeListener('openclaw:logsCleared', listener)
      }
    }
  }
}
