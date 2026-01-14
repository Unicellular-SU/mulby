import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('intools', {
  // 窗口控制
  window: {
    hide: (isRestorePreWindow?: boolean) => ipcRenderer.send('window:hide', isRestorePreWindow),
    show: () => ipcRenderer.send('window:show'),
    setSize: (width: number, height: number) =>
      ipcRenderer.send('window:setSize', width, height),
    setExpendHeight: (height: number) => ipcRenderer.send('window:setExpendHeight', height),
    center: () => ipcRenderer.send('window:center'),
    // 插件窗口控制
    detach: () => ipcRenderer.send('plugin:detach'),
    close: () => ipcRenderer.send('plugin:close'),
    setAlwaysOnTop: (flag: boolean) => ipcRenderer.send('window:alwaysOnTop', flag),
    getMode: () => ipcRenderer.invoke('plugin:getMode'),
    getWindowType: () => ipcRenderer.invoke('window:getType'),
    // 独立窗口标题栏控制
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    getState: () => ipcRenderer.invoke('window:getState'),
    reload: () => ipcRenderer.send('plugin:reload'),
    create: (url: string, options?: { width?: number; height?: number; title?: string }) =>
      ipcRenderer.invoke('window:create', url, options),
    // 窗口间通信
    sendToParent: (channel: string, ...args: unknown[]) =>
      ipcRenderer.send('window:sendToParent', channel, ...args),
    onChildMessage: (callback: (channel: string, ...args: unknown[]) => void) => {
      ipcRenderer.on('window:childMessage', (_, channel, ...args) => callback(channel, ...args))
    },
    // 页面内查找
    findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) =>
      ipcRenderer.invoke('webContents:findInPage', text, options),
    stopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection') =>
      ipcRenderer.send('webContents:stopFindInPage', action),
    // 原生文件拖拽
    startDrag: (filePath: string | string[]) => ipcRenderer.send('window:startDrag', filePath)
  },

  // 子输入框 API (uTools 特色功能)
  subInput: {
    set: (placeholder?: string, isFocus?: boolean) =>
      ipcRenderer.invoke('subInput:set', placeholder, isFocus),
    remove: () => ipcRenderer.invoke('subInput:remove'),
    setValue: (text: string) => ipcRenderer.send('subInput:setValue', text),
    focus: () => ipcRenderer.send('subInput:focus'),
    blur: () => ipcRenderer.send('subInput:blur'),
    select: () => ipcRenderer.send('subInput:select'),
    onChange: (callback: (data: { text: string }) => void) => {
      ipcRenderer.on('subInput:onChange', (_, data) => callback(data))
    }
  },


  // 主题
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (mode: 'light' | 'dark' | 'system') => ipcRenderer.invoke('theme:set', mode),
    getActual: () => ipcRenderer.invoke('theme:getActual')
  },

  // 主题变化事件
  onThemeChange: (callback: (theme: 'light' | 'dark') => void) => {
    ipcRenderer.on('theme:changed', (_, theme) => callback(theme))
  },

  // 窗口状态变化事件
  onWindowStateChange: (callback: (state: { isMaximized: boolean }) => void) => {
    ipcRenderer.on('window:stateChanged', (_, state) => callback(state))
  },

  // 剪贴板
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
    writeImage: (buffer: Buffer) => ipcRenderer.invoke('clipboard:writeImage', buffer),
    readFiles: () => ipcRenderer.invoke('clipboard:readFiles'),
    getFormat: () => ipcRenderer.invoke('clipboard:getFormat')
  },

  // 通知
  notification: {
    show: (message: string, type?: string) =>
      ipcRenderer.send('notification:show', message, type)
  },

  // 插件
  plugin: {
    getAll: () => ipcRenderer.invoke('plugin:getAll'),
    search: (query: string) => ipcRenderer.invoke('plugin:search', query),
    run: (name: string, featureCode: string, input?: string) =>
      ipcRenderer.invoke('plugin:run', name, featureCode, input),
    install: (filePath: string) => ipcRenderer.invoke('plugin:install', filePath),
    enable: (name: string) => ipcRenderer.invoke('plugin:enable', name),
    disable: (name: string) => ipcRenderer.invoke('plugin:disable', name),
    uninstall: (name: string) => ipcRenderer.invoke('plugin:uninstall', name),
    getReadme: (name: string) => ipcRenderer.invoke('plugin:getReadme', name),
    // 插件导航 API
    redirect: (label: string | [string, string], payload?: unknown) =>
      ipcRenderer.invoke('plugin:redirect', label, payload),
    outPlugin: (isKill?: boolean) => ipcRenderer.invoke('plugin:out', isKill)
  },

  // 插件窗口事件
  onPluginInit: (callback: (data: { pluginName: string; featureCode: string; input: string; mode?: string }) => void) => {
    ipcRenderer.on('plugin:init', (_, data) => callback(data))
  },

  // 插件附着事件（主窗口使用）
  onPluginAttach: (callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string; preloadPath: string }) => void) => {
    ipcRenderer.on('plugin:attach', (_, data) => callback(data))
  },

  // 插件分离事件（主窗口使用）
  onPluginDetached: (callback: () => void) => {
    ipcRenderer.on('plugin:detached', () => callback())
  },

  // 屏幕 API
  screen: {
    getAllDisplays: () => ipcRenderer.invoke('screen:getAllDisplays'),
    getPrimaryDisplay: () => ipcRenderer.invoke('screen:getPrimaryDisplay'),
    getDisplayNearestPoint: (point: { x: number; y: number }) =>
      ipcRenderer.invoke('screen:getDisplayNearestPoint', point),
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
    screenCapture: () => ipcRenderer.invoke('screen:startRegionCapture')
  },

  // Shell API
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
    openFolder: (path: string) => ipcRenderer.invoke('shell:openFolder', path),
    trashItem: (path: string) => ipcRenderer.invoke('shell:trashItem', path),
    beep: () => ipcRenderer.invoke('shell:beep')
  },

  // Filesystem API
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

  // Dialog API
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

  // System API
  system: {
    getSystemInfo: () => ipcRenderer.invoke('system:getSystemInfo'),
    getAppInfo: () => ipcRenderer.invoke('system:getAppInfo'),
    getPath: (name: string) => ipcRenderer.invoke('system:getPath', name),
    getEnv: (name: string) => ipcRenderer.invoke('system:getEnv', name),
    getIdleTime: () => ipcRenderer.invoke('system:getIdleTime')
  },

  // GlobalShortcut API
  shortcut: {
    register: (accelerator: string) => ipcRenderer.invoke('shortcut:register', accelerator),
    unregister: (accelerator: string) => ipcRenderer.invoke('shortcut:unregister', accelerator),
    unregisterAll: () => ipcRenderer.invoke('shortcut:unregisterAll'),
    isRegistered: (accelerator: string) => ipcRenderer.invoke('shortcut:isRegistered', accelerator),
    onTriggered: (callback: (accelerator: string) => void) => {
      ipcRenderer.on('shortcut:triggered', (_, accelerator) => callback(accelerator))
    }
  },

  // Security API
  security: {
    isEncryptionAvailable: () => ipcRenderer.invoke('security:isEncryptionAvailable'),
    encryptString: (plainText: string) => ipcRenderer.invoke('security:encryptString', plainText),
    decryptString: (encrypted: Buffer) => ipcRenderer.invoke('security:decryptString', encrypted)
  },

  // Storage API
  storage: {
    get: (key: string, namespace?: string) => ipcRenderer.invoke('storage:get', key, namespace),
    set: (key: string, value: unknown, namespace?: string) => ipcRenderer.invoke('storage:set', key, value, namespace),
    remove: (key: string, namespace?: string) => ipcRenderer.invoke('storage:remove', key, namespace)
  },

  // Media API
  media: {
    getAccessStatus: (mediaType: 'microphone' | 'camera') =>
      ipcRenderer.invoke('media:getAccessStatus', mediaType),
    askForAccess: (mediaType: 'microphone' | 'camera') =>
      ipcRenderer.invoke('media:askForAccess', mediaType),
    hasCameraAccess: () => ipcRenderer.invoke('media:hasCameraAccess'),
    hasMicrophoneAccess: () => ipcRenderer.invoke('media:hasMicrophoneAccess')
  },

  // Power API
  power: {
    getSystemIdleTime: () => ipcRenderer.invoke('power:getSystemIdleTime'),
    getSystemIdleState: (idleThreshold: number) =>
      ipcRenderer.invoke('power:getSystemIdleState', idleThreshold),
    isOnBatteryPower: () => ipcRenderer.invoke('power:isOnBatteryPower'),
    getCurrentThermalState: () => ipcRenderer.invoke('power:getCurrentThermalState'),
    onSuspend: (callback: () => void) => {
      ipcRenderer.on('power:suspend', () => callback())
    },
    onResume: (callback: () => void) => {
      ipcRenderer.on('power:resume', () => callback())
    },
    onAC: (callback: () => void) => {
      ipcRenderer.on('power:on-ac', () => callback())
    },
    onBattery: (callback: () => void) => {
      ipcRenderer.on('power:on-battery', () => callback())
    },
    onLockScreen: (callback: () => void) => {
      ipcRenderer.on('power:lock-screen', () => callback())
    },
    onUnlockScreen: (callback: () => void) => {
      ipcRenderer.on('power:unlock-screen', () => callback())
    }
  },

  // Tray API
  tray: {
    create: (options: { icon: string; tooltip?: string; title?: string }) =>
      ipcRenderer.invoke('tray:create', options),
    destroy: () => ipcRenderer.invoke('tray:destroy'),
    setIcon: (icon: string) => ipcRenderer.invoke('tray:setIcon', icon),
    setTooltip: (tooltip: string) => ipcRenderer.invoke('tray:setTooltip', tooltip),
    setTitle: (title: string) => ipcRenderer.invoke('tray:setTitle', title),
    exists: () => ipcRenderer.invoke('tray:exists')
  },

  // HTTP API
  http: {
    request: (options: any) => ipcRenderer.invoke('http:request', options),
    get: (url: string, headers?: Record<string, string>) => ipcRenderer.invoke('http:get', url, headers),
    post: (url: string, body?: any, headers?: Record<string, string>) => ipcRenderer.invoke('http:post', url, body, headers),
    put: (url: string, body?: any, headers?: Record<string, string>) => ipcRenderer.invoke('http:put', url, body, headers),
    delete: (url: string, headers?: Record<string, string>) => ipcRenderer.invoke('http:delete', url, headers)
  },

  // Network API
  network: {
    isOnline: () => ipcRenderer.invoke('network:isOnline'),
    onOnline: (callback: () => void) => {
      window.addEventListener('online', callback)
    },
    onOffline: (callback: () => void) => {
      window.addEventListener('offline', callback)
    }
  },

  // Menu API
  menu: {
    showContextMenu: (items: {
      label: string
      type?: 'normal' | 'separator' | 'checkbox' | 'radio'
      checked?: boolean
      enabled?: boolean
      id?: string
      submenu?: any[]
    }[]) => ipcRenderer.invoke('menu:showContextMenu', items)
  },

  // Geolocation API
  // 注意: 使用主进程 IP 定位来绕过 Google 服务在中国被屏蔽的问题
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

  // TTS API
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

  // Plugin Host API（插件 UI 与后端通信）
  host: {
    invoke: (pluginName: string, method: string, ...args: unknown[]) =>
      ipcRenderer.invoke('host:invoke', pluginName, method, ...args),
    status: (pluginName: string) =>
      ipcRenderer.invoke('host:status', pluginName),
    restart: (pluginName: string) =>
      ipcRenderer.invoke('host:restart', pluginName)
  }
})

// ==========================================
// 主窗口专用 API（用于 SubInput 等功能）
// ==========================================
contextBridge.exposeInMainWorld('intoolsMain', {
  // SubInput 事件监听（主窗口接收插件发来的控制指令）
  subInput: {
    onEnabled: (callback: (data: { placeholder: string; isFocus: boolean }) => void) => {
      ipcRenderer.on('subInput:enabled', (_, data) => callback(data))
    },
    onDisabled: (callback: () => void) => {
      ipcRenderer.on('subInput:disabled', () => callback())
    },
    onSetValue: (callback: (text: string) => void) => {
      ipcRenderer.on('subInput:setValue', (_, text) => callback(text))
    },
    onFocus: (callback: () => void) => {
      ipcRenderer.on('subInput:focus', () => callback())
    },
    onBlur: (callback: () => void) => {
      ipcRenderer.on('subInput:blur', () => callback())
    },
    onSelect: (callback: () => void) => {
      ipcRenderer.on('subInput:select', () => callback())
    },
    // 主窗口输入变化时发送给主进程（转发给插件）
    sendChange: (text: string) => {
      ipcRenderer.send('subInput:change', text)
    }
  }
})

