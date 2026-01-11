export interface FileInfo {
  path: string
  name: string
  size: number
  type: string
  isDirectory: boolean
}

// 搜索结果项（功能入口）
export interface SearchResultItem {
  pluginId: string
  pluginName: string
  displayName: string
  featureCode: string
  featureExplain: string
  matchType: 'keyword' | 'regex'
  icon?: {
    type: 'url' | 'svg' | 'data-url'
    value: string
  }
}

export interface PluginInfo {
  id: string
  name: string
  displayName: string
  description: string
  features: {
    code: string
    explain: string
    cmds: { type: string; value?: string; match?: string; exts?: string[] }[]
  }[]
  enabled: boolean
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemeInfo {
  mode: ThemeMode
  actual: 'light' | 'dark'
}

// Screen API 类型
export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  rotation: number
  isPrimary: boolean
}

export interface CaptureSource {
  id: string
  name: string
  thumbnailDataUrl: string
  displayId?: string
  appIconDataUrl?: string
}

export interface CaptureOptions {
  types?: ('screen' | 'window')[]
  thumbnailSize?: { width: number; height: number }
}

export interface ScreenshotOptions {
  sourceId?: string
  format?: 'png' | 'jpeg'
  quality?: number
}

export interface RecordingOptions {
  sourceId: string
  audio?: boolean
  frameRate?: number
}

// Dialog API 类型
export interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: { name: string; extensions: string[] }[]
  properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
}

export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
}

// System API 类型
export interface SystemInfo {
  platform: string
  arch: string
  hostname: string
  username: string
  homedir: string
  tmpdir: string
  cpus: number
  totalmem: number
  freemem: number
  uptime: number
  osVersion: string
  osRelease: string
}

export interface AppInfo {
  name: string
  version: string
  locale: string
  isPackaged: boolean
  userDataPath: string
}

export interface ElectronAPI {
  window: {
    hide: () => void
    setSize: (width: number, height: number) => void
    center: () => void
    detach: () => void
    close: () => void
    setAlwaysOnTop: (flag: boolean) => void
    getMode: () => Promise<'attached' | 'detached'>
  }
  theme: {
    get: () => Promise<ThemeInfo>
    set: (mode: ThemeMode) => Promise<ThemeInfo>
    getActual: () => Promise<'light' | 'dark'>
  }
  onThemeChange: (callback: (theme: 'light' | 'dark') => void) => void
  clipboard: {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<void>
    readImage: () => Promise<Buffer | null>
    writeImage: (buffer: Buffer) => Promise<void>
    readFiles: () => Promise<FileInfo[]>
    getFormat: () => Promise<'text' | 'image' | 'html' | 'empty'>
  }
  notification: {
    show: (message: string, type?: string) => void
  }
  plugin: {
    getAll: () => Promise<PluginInfo[]>
    search: (query: string) => Promise<SearchResultItem[]>
    run: (name: string, featureCode: string, input?: string) => Promise<{ success: boolean; hasUI?: boolean; error?: string }>
    install: (filePath: string) => Promise<{ success: boolean; pluginName?: string; isUpdate?: boolean; oldVersion?: string; newVersion?: string; error?: string }>
    enable: (name: string) => Promise<{ success: boolean; error?: string }>
    disable: (name: string) => Promise<{ success: boolean; error?: string }>
    uninstall: (name: string) => Promise<{ success: boolean; error?: string }>
    getReadme: (name: string) => Promise<string | null>
  }
  onPluginInit: (callback: (data: { pluginName: string; featureCode: string; input: string; mode?: string }) => void) => void
  onPluginAttach: (callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; mode: 'panel' }) => void) => void
  onPluginDetached: (callback: () => void) => void
  screen: {
    getAllDisplays: () => Promise<DisplayInfo[]>
    getPrimaryDisplay: () => Promise<DisplayInfo>
    getDisplayNearestPoint: (point: { x: number; y: number }) => Promise<DisplayInfo>
    getCursorScreenPoint: () => Promise<{ x: number; y: number }>
    getSources: (options?: CaptureOptions) => Promise<CaptureSource[]>
    capture: (options?: ScreenshotOptions) => Promise<Buffer>
    captureRegion: (
      region: { x: number; y: number; width: number; height: number },
      options?: Omit<ScreenshotOptions, 'sourceId'>
    ) => Promise<Buffer>
    getMediaStreamConstraints: (options: RecordingOptions) => Promise<object>
  }
  shell: {
    openPath: (path: string) => Promise<string>
    openExternal: (url: string) => Promise<void>
    showItemInFolder: (path: string) => Promise<void>
    openFolder: (path: string) => Promise<string>
    trashItem: (path: string) => Promise<void>
    beep: () => Promise<void>
  }
  dialog: {
    showOpenDialog: (options?: OpenDialogOptions) => Promise<string[]>
    showSaveDialog: (options?: SaveDialogOptions) => Promise<string | null>
    showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number; checkboxChecked: boolean }>
    showErrorBox: (title: string, content: string) => Promise<void>
  }
  system: {
    getSystemInfo: () => Promise<SystemInfo>
    getAppInfo: () => Promise<AppInfo>
    getPath: (name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos') => Promise<string>
    getEnv: (name: string) => Promise<string | undefined>
    getIdleTime: () => Promise<number>
  }
  shortcut: {
    register: (accelerator: string) => Promise<boolean>
    unregister: (accelerator: string) => Promise<void>
    unregisterAll: () => Promise<void>
    isRegistered: (accelerator: string) => Promise<boolean>
    onTriggered: (callback: (accelerator: string) => void) => void
  }
  security: {
    isEncryptionAvailable: () => Promise<boolean>
    encryptString: (plainText: string) => Promise<Buffer>
    decryptString: (encrypted: Buffer) => Promise<string>
  }
  media: {
    getAccessStatus: (mediaType: 'microphone' | 'camera') => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
    askForAccess: (mediaType: 'microphone' | 'camera') => Promise<boolean>
    hasCameraAccess: () => Promise<boolean>
    hasMicrophoneAccess: () => Promise<boolean>
  }
  power: {
    getSystemIdleTime: () => Promise<number>
    getSystemIdleState: (idleThreshold: number) => Promise<'active' | 'idle' | 'locked' | 'unknown'>
    isOnBatteryPower: () => Promise<boolean>
    getCurrentThermalState: () => Promise<'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'>
    onSuspend: (callback: () => void) => void
    onResume: (callback: () => void) => void
    onAC: (callback: () => void) => void
    onBattery: (callback: () => void) => void
    onLockScreen: (callback: () => void) => void
    onUnlockScreen: (callback: () => void) => void
  }
  tray: {
    create: (options: { icon: string; tooltip?: string; title?: string }) => Promise<boolean>
    destroy: () => Promise<void>
    setIcon: (icon: string) => Promise<void>
    setTooltip: (tooltip: string) => Promise<void>
    setTitle: (title: string) => Promise<void>
    exists: () => Promise<boolean>
  }
  network: {
    isOnline: () => Promise<boolean>
    onOnline: (callback: () => void) => void
    onOffline: (callback: () => void) => void
  }
  menu: {
    showContextMenu: (items: {
      label: string
      type?: 'normal' | 'separator' | 'checkbox' | 'radio'
      checked?: boolean
      enabled?: boolean
      id?: string
      submenu?: any[]
    }[]) => Promise<string | null>
  }
  geolocation: {
    getAccessStatus: () => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
    requestAccess: () => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
    canGetPosition: () => Promise<boolean>
    openSettings: () => Promise<void>
    getCurrentPosition: () => Promise<{
      latitude: number
      longitude: number
      accuracy: number
      altitude?: number | null
      altitudeAccuracy?: number | null
      heading?: number | null
      speed?: number | null
      timestamp: number
    }>
  }
  tts: {
    speak: (text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }) => Promise<void>
    stop: () => void
    pause: () => void
    resume: () => void
    getVoices: () => { name: string; lang: string; default: boolean; localService: boolean }[]
    isSpeaking: () => boolean
  }
}

declare global {
  interface Window {
    intools: ElectronAPI
  }
}

export { }
