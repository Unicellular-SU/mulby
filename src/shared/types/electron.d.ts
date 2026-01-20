import { InBrowser } from './inbrowser'
import type { InputPayload, InputAttachment } from './plugin'
import type { AppSettings, ShortcutStatusMap } from './settings'

// 日志条目接口
export interface LogEntry {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'crash'
  pluginId: string
  message: string
  args?: unknown[]
  crashDetails?: {
    reason: string
    exitCode?: number
    windowId?: number
  }
}

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
  featureRoute?: string
  matchType: 'keyword' | 'regex' | 'files' | 'img'
  icon?: {
    type: 'url' | 'svg' | 'data-url' | 'emoji'
    value: string
  }
}

export interface PluginInfo {
  id: string
  name: string
  displayName: string
  description: string
  version?: string
  author?: string
  homepage?: string
  main?: string
  ui?: string
  window?: {
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    maxWidth?: number
    maxHeight?: number
  }
  icon?: {
    type: 'url' | 'svg' | 'data-url' | 'emoji'
    value: string
  }
  path?: string
  builtin?: boolean
  isDev?: boolean
  features: {
    code: string
    explain: string
    cmds: { type: 'keyword' | 'regex' | 'files' | 'img' | 'over' | string; value?: string; match?: string; explain?: string; exts?: string[] }[]
    mode?: 'ui' | 'silent' | 'detached'
    route?: string
    icon?: {
      type: 'url' | 'svg' | 'data-url' | 'emoji'
      value: string
    }
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

// Color Picker API 类型
export interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

// FFmpeg API 类型
export interface FFmpegRunProgress {
  bitrate: string
  fps: number
  frame: number
  percent?: number
  q: number | string
  size: string
  speed: string
  time: string
}

export interface FFmpegDownloadProgress {
  phase: 'downloading' | 'extracting' | 'done'
  percent: number
  downloaded?: number
  total?: number
}

export type FFmpegRunProgressCallback = (progress: FFmpegRunProgress) => void
export type FFmpegDownloadProgressCallback = (progress: FFmpegDownloadProgress) => void

export interface FFmpegTask {
  promise: Promise<void>
  kill(): void
  quit(): void
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
    setExpendHeight: (height: number) => void
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
  app: {
    onOpenSettings: (callback: () => void) => void
    onOpenPluginStore: (callback: () => void) => void
    onOpenPluginManager: (callback: () => void) => void
  }
  clipboard: {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<void>
    readImage: () => Promise<Buffer | null>
    writeImage: (image: string | Buffer | ArrayBuffer | Uint8Array) => Promise<boolean>
    readFiles: () => Promise<FileInfo[]>
    writeFiles: (files: string | string[]) => Promise<boolean>
    getFormat: () => Promise<'text' | 'image' | 'html' | 'empty'>
  }
  input: {
    hideMainWindowPasteText: (text: string) => Promise<boolean>
    hideMainWindowPasteImage: (image: string | Buffer) => Promise<boolean>
    hideMainWindowPasteFile: (filePaths: string | string[]) => Promise<boolean>
    hideMainWindowTypeString: (text: string) => Promise<boolean>
  }
  notification: {
    show: (message: string, type?: string) => void
  }
  storage: {
    get: (key: string, namespace?: string) => Promise<any>
    set: (key: string, value: unknown, namespace?: string) => Promise<boolean>
    remove: (key: string, namespace?: string) => Promise<boolean>
    getAll?: (namespace?: string) => Promise<Record<string, unknown>>
    clear?: (namespace?: string) => Promise<boolean>
  }
  settings: {
    get: () => Promise<{ settings: AppSettings; shortcutStatus: ShortcutStatusMap }>
    update: (partial: Partial<AppSettings>) => Promise<{ settings: AppSettings; shortcutStatus: ShortcutStatusMap }>
    reset: () => Promise<{ settings: AppSettings; shortcutStatus: ShortcutStatusMap }>
    pauseShortcuts: () => Promise<ShortcutStatusMap>
    resumeShortcuts: () => Promise<ShortcutStatusMap>
  }
  developer: {
    addPluginPath: (path: string) => Promise<{ success: boolean; error?: string }>
    removePluginPath: (path: string) => Promise<{ success: boolean }>
    reloadPlugins: () => Promise<{ success: boolean }>
    selectDirectory: () => Promise<string | null>
  }
  plugin: {
    getAll: () => Promise<PluginInfo[]>
    search: (query: string | InputPayload) => Promise<SearchResultItem[]>
    run: (name: string, featureCode: string, input?: string | InputPayload) => Promise<{ success: boolean; hasUI?: boolean; error?: string }>
    install: (filePath: string) => Promise<{ success: boolean; pluginName?: string; isUpdate?: boolean; oldVersion?: string; newVersion?: string; error?: string }>
    enable: (name: string) => Promise<{ success: boolean; error?: string }>
    disable: (name: string) => Promise<{ success: boolean; error?: string }>
    uninstall: (name: string) => Promise<{ success: boolean; error?: string }>
    getReadme: (name: string) => Promise<string | null>
  }
  onPluginInit: (callback: (data: { pluginName: string; featureCode: string; input: string; attachments?: InputAttachment[]; mode?: string }) => void) => void
  onPluginAttach: (callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; attachments?: InputAttachment[]; mode: 'panel' }) => void) => void
  onPluginDetached: (callback: () => void) => void
  screen: {
    getAllDisplays: () => Promise<DisplayInfo[]>
    getPrimaryDisplay: () => Promise<DisplayInfo>
    getDisplayNearestPoint: (point: { x: number; y: number }) => Promise<DisplayInfo>
    getDisplayMatching: (rect: { x: number; y: number; width: number; height: number }) => Promise<DisplayInfo>
    getCursorScreenPoint: () => Promise<{ x: number; y: number }>
    getSources: (options?: CaptureOptions) => Promise<CaptureSource[]>
    capture: (options?: ScreenshotOptions) => Promise<Buffer>
    captureRegion: (
      region: { x: number; y: number; width: number; height: number },
      options?: Omit<ScreenshotOptions, 'sourceId'>
    ) => Promise<Buffer>
    getMediaStreamConstraints: (options: RecordingOptions) => Promise<object>
    screenCapture: () => Promise<string | null>
    colorPick: () => Promise<ColorPickResult | null>
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
    getPath: (name: 'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs') => Promise<string>
    getEnv: (name: string) => Promise<string | undefined>
    getIdleTime: () => Promise<number>
    // 新增 API
    getFileIcon: (filePath: string) => Promise<string>
    getNativeId: () => Promise<string>
    isDev: () => Promise<boolean>
    isMacOS: () => Promise<boolean>
    isWindows: () => Promise<boolean>
    isLinux: () => Promise<boolean>
  }
  permission: {
    getStatus: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') => Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
    request: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') => Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
    canRequest: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') => Promise<boolean>
    openSystemSettings: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') => Promise<boolean>
    isAccessibilityTrusted: () => Promise<boolean>
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
  inbrowser: {
    goto: (url: string, headers?: Record<string, string>, timeout?: number) => InBrowser
  }
  // Sharp 图像处理 API
  sharp: SharpFunction
  getSharpVersion: () => Promise<{ sharp: Record<string, string>; format: Record<string, any> }>
  // FFmpeg 音视频处理 API
  ffmpeg: {
    isAvailable: () => Promise<boolean>
    getVersion: () => Promise<string | null>
    getPath: () => Promise<string | null>
    download: (onProgress?: FFmpegDownloadProgressCallback) => Promise<{ success: boolean; error?: string }>
    run: (args: string[], onProgress?: FFmpegRunProgressCallback) => FFmpegTask
  }
  // 日志 API
  log: {
    debug: (message: string, ...args: unknown[]) => void
    info: (message: string, ...args: unknown[]) => void
    warn: (message: string, ...args: unknown[]) => void
    error: (message: string, ...args: unknown[]) => void
    getLogs: (options?: { pluginId?: string; level?: string; limit?: number }) => Promise<LogEntry[]>
    clear: (pluginId?: string) => Promise<{ success: boolean }>
    getLogsDir: () => Promise<string>
    subscribe: () => Promise<{ success: boolean }>
    onLog: (callback: (entry: LogEntry) => void) => void
  }
}

/**
 * Sharp 图像处理代理接口
 * 支持链式调用，在调用终结方法时触发实际执行
 */
export interface SharpProxy {
  // 尺寸调整
  resize(width?: number, height?: number, options?: { fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'; position?: string; background?: string | object }): SharpProxy
  extend(options: { top?: number; bottom?: number; left?: number; right?: number; background?: string | object }): SharpProxy
  extract(options: { left: number; top: number; width: number; height: number }): SharpProxy
  trim(options?: { threshold?: number; lineArt?: boolean }): SharpProxy

  // 变换
  rotate(angle?: number, options?: { background?: string | object }): SharpProxy
  flip(): SharpProxy
  flop(): SharpProxy
  affine(matrix: number[][], options?: { background?: string | object; idx?: number; idy?: number; odx?: number; ody?: number }): SharpProxy

  // 图像处理
  median(size?: number): SharpProxy
  blur(sigma?: number): SharpProxy
  sharpen(options?: { sigma?: number; m1?: number; m2?: number; x1?: number; y2?: number; y3?: number }): SharpProxy
  flatten(options?: { background?: string | object }): SharpProxy
  gamma(gamma?: number, gammaOut?: number): SharpProxy
  negate(options?: { alpha?: boolean }): SharpProxy
  normalise(options?: { lower?: number; upper?: number }): SharpProxy
  normalize(options?: { lower?: number; upper?: number }): SharpProxy
  clahe(options: { width: number; height: number; maxSlope?: number }): SharpProxy
  convolve(options: { width: number; height: number; kernel: number[]; scale?: number; offset?: number }): SharpProxy
  threshold(threshold?: number, options?: { greyscale?: boolean }): SharpProxy
  linear(a?: number | number[], b?: number | number[]): SharpProxy
  recomb(inputMatrix: number[][]): SharpProxy
  modulate(options?: { brightness?: number; saturation?: number; hue?: number; lightness?: number }): SharpProxy

  // 颜色处理
  tint(color: string | object): SharpProxy
  greyscale(greyscale?: boolean): SharpProxy
  grayscale(grayscale?: boolean): SharpProxy
  pipelineColorspace(colorspace: string): SharpProxy
  toColorspace(colorspace: string): SharpProxy

  // 通道操作
  removeAlpha(): SharpProxy
  ensureAlpha(alpha?: number): SharpProxy
  extractChannel(channel: number | 'red' | 'green' | 'blue' | 'alpha'): SharpProxy
  joinChannel(images: string | Buffer | ArrayBuffer | Uint8Array | (string | Buffer | ArrayBuffer | Uint8Array)[], options?: { raw?: { width: number; height: number; channels: number } }): SharpProxy
  bandbool(boolOp: 'and' | 'or' | 'eor'): SharpProxy

  // 合成
  composite(images: { input: string | Buffer | { create?: any; text?: any }; gravity?: string; top?: number; left?: number; tile?: boolean; blend?: string; density?: number; raw?: { width: number; height: number; channels: number } }[]): SharpProxy

  // 输出格式
  png(options?: { progressive?: boolean; compressionLevel?: number; palette?: boolean; quality?: number; effort?: number; colors?: number; dither?: number }): SharpProxy
  jpeg(options?: { quality?: number; progressive?: boolean; chromaSubsampling?: string; optimiseCoding?: boolean; mozjpeg?: boolean; trellisQuantisation?: boolean; overshootDeringing?: boolean; optimiseScans?: boolean; quantisationTable?: number }): SharpProxy
  webp(options?: { quality?: number; alphaQuality?: number; lossless?: boolean; nearLossless?: boolean; smartSubsample?: boolean; effort?: number; loop?: number; delay?: number | number[] }): SharpProxy
  gif(options?: { reuse?: boolean; progressive?: boolean; colors?: number; effort?: number; dither?: number; interFrameMaxError?: number; interPaletteMaxError?: number; loop?: number; delay?: number | number[]; force?: boolean }): SharpProxy
  tiff(options?: { quality?: number; force?: boolean; compression?: string; predictor?: string; pyramid?: boolean; tile?: boolean; tileWidth?: number; tileHeight?: number; xres?: number; yres?: number; resolutionUnit?: string; bitdepth?: number }): SharpProxy
  avif(options?: { quality?: number; lossless?: boolean; effort?: number; chromaSubsampling?: string }): SharpProxy
  heif(options?: { quality?: number; compression?: string; lossless?: boolean; effort?: number; chromaSubsampling?: string }): SharpProxy
  raw(options?: { depth?: string }): SharpProxy

  // 元数据
  withMetadata(options?: { orientation?: number; icc?: string; exif?: object; density?: number }): SharpProxy
  keepExif(): SharpProxy
  withExif(exif: object): SharpProxy
  keepIccProfile(): SharpProxy
  withIccProfile(icc: string, options?: { attach?: boolean }): SharpProxy

  // 其他
  timeout(options: { seconds: number }): SharpProxy
  tile(options?: { size?: number; overlap?: number; angle?: number; background?: string | object; depth?: string; skipBlanks?: number; container?: string; layout?: string; centre?: boolean; id?: string; basename?: string }): SharpProxy
  clone(): SharpProxy

  // 终结方法 - 触发实际执行
  toBuffer(options?: { resolveWithObject?: boolean }): Promise<Buffer | { data: Buffer; info: { format: string; width: number; height: number; channels: number; premultiplied: boolean; size: number } }>
  toFile(fileOut: string, callback?: (err: Error | null, info: { format: string; width: number; height: number; channels: number; premultiplied: boolean; size: number }) => void): Promise<{ format: string; width: number; height: number; channels: number; premultiplied: boolean; size: number }>
  metadata(): Promise<{ format?: string; size?: number; width?: number; height?: number; space?: string; channels?: number; depth?: string; density?: number; chromaSubsampling?: string; isProgressive?: boolean; pages?: number; pageHeight?: number; loop?: number; delay?: number[]; hasProfile?: boolean; hasAlpha?: boolean; orientation?: number; exif?: Buffer; icc?: Buffer; iptc?: Buffer; xmp?: Buffer; tifftagPhotoshop?: Buffer }>
  stats(): Promise<{ channels: { min: number; max: number; sum: number; squaresSum: number; mean: number; stdev: number; minX: number; minY: number; maxX: number; maxY: number }[]; isOpaque: boolean; entropy: number; sharpness: number; dominant: { r: number; g: number; b: number } }>
}

/**
 * Sharp 构造函数类型
 */
export type SharpFunction = (
  input?: string | Buffer | ArrayBuffer | Uint8Array | { create?: { width: number; height: number; channels: number; background?: string | object; noise?: { type: 'gaussian'; mean?: number; sigma?: number } }; text?: { text: string; width?: number; height?: number; channels?: number; rgba?: boolean } } | any[],
  options?: { raw?: { width: number; height: number; channels: number }; create?: { width: number; height: number; channels: number; background?: string | object }; text?: { text: string; width?: number; height?: number; channels?: number; rgba?: boolean }; animated?: boolean; limitInputPixels?: number; failOn?: 'error' | 'warning' | 'none'; density?: number; ignoreIcc?: boolean; pages?: number; page?: number; subifd?: number; level?: number; pdfBackground?: string | object }
) => SharpProxy

declare global {
  interface Window {
    intools: ElectronAPI
  }
}

export { }
