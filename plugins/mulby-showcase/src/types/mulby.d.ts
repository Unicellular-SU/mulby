// Mulby API 类型定义

interface ClipboardFileInfo {
  path: string
  name: string
  size: number
  isDirectory: boolean
}

interface MulbyClipboard {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  readImage(): Promise<ArrayBuffer | null>
  writeImage(image: string | ArrayBuffer): Promise<void>
  readFiles(): Promise<ClipboardFileInfo[]>
  writeFiles(files: string | string[]): Promise<boolean>
  getFormat(): Promise<'text' | 'image' | 'files' | 'empty'>
}

interface MulbyInput {
  hideMainWindowPasteText(text: string): Promise<boolean>
  hideMainWindowPasteImage(image: string | ArrayBuffer): Promise<boolean>
  hideMainWindowPasteFile(filePaths: string | string[]): Promise<boolean>
  hideMainWindowTypeString(text: string): Promise<boolean>
}

interface MulbyNotification {
  show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void
}

interface BrowserWindowProxy {
  id: number
  show(): Promise<void>
  hide(): Promise<void>
  close(): Promise<void>
  focus(): Promise<void>
  setTitle(title: string): Promise<void>
  setSize(width: number, height: number): Promise<void>
  setPosition(x: number, y: number): Promise<void>
  postMessage(channel: string, ...args: unknown[]): Promise<void>
}

interface MulbyWindow {
  hide(isRestorePreWindow?: boolean): void
  show(): void
  setSize(width: number, height: number): void
  setExpendHeight(height: number): void
  center(): void
  create(url: string, options?: { width?: number; height?: number; title?: string }): Promise<BrowserWindowProxy | null>
  close(): void
  detach(): void
  setAlwaysOnTop(flag: boolean): void
  getMode(): Promise<'attached' | 'detached'>
  getWindowType(): Promise<'main' | 'detach'>
  minimize(): void
  maximize(): void
  getState(): Promise<{ isMaximized: boolean; isAlwaysOnTop: boolean }>
  reload(): void
  // 窗口间通信
  sendToParent(channel: string, ...args: unknown[]): void
  onChildMessage(callback: (channel: string, ...args: unknown[]) => void): void
  // 页面内查找
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): Promise<number>
  stopFindInPage(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  // 原生文件拖拽
  startDrag(filePath: string | string[]): void
}

// SubInput 子输入框 API
interface MulbySubInput {
  set(placeholder?: string, isFocus?: boolean): Promise<boolean>
  remove(): Promise<boolean>
  setValue(text: string): void
  focus(): void
  blur(): void
  select(): void
  onChange(callback: (data: { text: string }) => void): void
}

interface MulbyTheme {
  get(): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  set(mode: 'light' | 'dark' | 'system'): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  getActual(): Promise<'light' | 'dark'>
}

interface MulbyPlugin {
  getAll(): Promise<any[]>
  search(query: string): Promise<any[]>
  run(name: string, featureCode: string, input?: string): Promise<any>
  install(filePath: string): Promise<any>
  enable(name: string): Promise<any>
  disable(name: string): Promise<any>
  uninstall(name: string): Promise<any>
  // 插件导航 API
  redirect(label: string | [string, string], payload?: unknown): Promise<boolean | { candidates: { name: string; displayName: string }[] }>
  outPlugin(isKill?: boolean): Promise<boolean>
}

// Screen API 类型
interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  rotation: number
  isPrimary: boolean
}

interface CaptureSource {
  id: string
  name: string
  thumbnailDataUrl: string
  displayId?: string
  appIconDataUrl?: string
}

// Color Picker 返回类型
interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

interface MulbyScreen {
  getAllDisplays(): Promise<DisplayInfo[]>
  getPrimaryDisplay(): Promise<DisplayInfo>
  getDisplayNearestPoint(point: { x: number; y: number }): Promise<DisplayInfo>
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): Promise<DisplayInfo>
  getCursorScreenPoint(): Promise<{ x: number; y: number }>
  getSources(options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }): Promise<CaptureSource[]>
  capture(options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  captureRegion(region: { x: number; y: number; width: number; height: number }, options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  getMediaStreamConstraints(options: { sourceId: string; audio?: boolean; frameRate?: number }): Promise<object>
  screenCapture(): Promise<string | null>
  colorPick(): Promise<ColorPickResult | null>
}

// Shell API 类型
interface MulbyShell {
  openPath(path: string): Promise<string>
  openExternal(url: string): Promise<void>
  showItemInFolder(path: string): Promise<void>
  openFolder(path: string): Promise<string>
  trashItem(path: string): Promise<void>
  beep(): Promise<void>
}

// Dialog API 类型
interface MulbyDialog {
  showOpenDialog(options?: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: { name: string; extensions: string[] }[]
    properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
  }): Promise<string[]>
  showSaveDialog(options?: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null>
  showMessageBox(options: {
    type?: 'none' | 'info' | 'error' | 'question' | 'warning'
    title?: string
    message: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
  }): Promise<{ response: number; checkboxChecked: boolean }>
  showErrorBox(title: string, content: string): Promise<void>
}

// System API 类型
interface SystemInfo {
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

interface AppInfo {
  name: string
  version: string
  locale: string
  isPackaged: boolean
  userDataPath: string
}

interface MulbySystem {
  getSystemInfo(): Promise<SystemInfo>
  getAppInfo(): Promise<AppInfo>
  getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs'): Promise<string>
  getEnv(name: string): Promise<string | undefined>
  getIdleTime(): Promise<number>
  // 新增 API
  getFileIcon(filePath: string): Promise<string>
  getNativeId(): Promise<string>
  isDev(): Promise<boolean>
  isMacOS(): Promise<boolean>
  isWindows(): Promise<boolean>
  isLinux(): Promise<boolean>
}

interface MulbyPermission {
  getStatus(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
  request(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
  canRequest(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<boolean>
  openSystemSettings(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<boolean>
  isAccessibilityTrusted(): Promise<boolean>
}

// GlobalShortcut API 类型
interface MulbyShortcut {
  register(accelerator: string): Promise<boolean>
  unregister(accelerator: string): Promise<void>
  unregisterAll(): Promise<void>
  isRegistered(accelerator: string): Promise<boolean>
  onTriggered(callback: (accelerator: string) => void): void
}

// Security API 类型
interface MulbySecurity {
  isEncryptionAvailable(): Promise<boolean>
  encryptString(plainText: string): Promise<ArrayBuffer>
  decryptString(encrypted: ArrayBuffer): Promise<string>
}

// Media API 类型
interface MulbyMedia {
  getAccessStatus(mediaType: 'microphone' | 'camera'): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  askForAccess(mediaType: 'microphone' | 'camera'): Promise<boolean>
  hasCameraAccess(): Promise<boolean>
  hasMicrophoneAccess(): Promise<boolean>
}

// Power API 类型
interface MulbyPower {
  getSystemIdleTime(): Promise<number>
  getSystemIdleState(idleThreshold: number): Promise<'active' | 'idle' | 'locked' | 'unknown'>
  isOnBatteryPower(): Promise<boolean>
  getCurrentThermalState(): Promise<'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'>
  onSuspend(callback: () => void): void
  onResume(callback: () => void): void
  onAC(callback: () => void): void
  onBattery(callback: () => void): void
  onLockScreen(callback: () => void): void
  onUnlockScreen(callback: () => void): void
}

// Tray API 类型
interface MulbyTray {
  create(options: { icon: string; tooltip?: string; title?: string }): Promise<boolean>
  destroy(): Promise<void>
  setIcon(icon: string): Promise<void>
  setTooltip(tooltip: string): Promise<void>
  setTitle(title: string): Promise<void>
  exists(): Promise<boolean>
}

// Network API 类型
interface MulbyNetwork {
  isOnline(): Promise<boolean>
  onOnline(callback: () => void): void
  onOffline(callback: () => void): void
}

// Menu API 类型
interface MulbyMenu {
  showContextMenu(items: {
    label: string
    type?: 'normal' | 'separator' | 'checkbox' | 'radio'
    checked?: boolean
    enabled?: boolean
    id?: string
    submenu?: any[]
  }[]): Promise<string | null>
}

// Geolocation API 类型
interface MulbyGeolocation {
  getAccessStatus(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  requestAccess(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  canGetPosition(): Promise<boolean>
  openSettings(): Promise<void>
  getCurrentPosition(): Promise<{
    latitude: number
    longitude: number
    accuracy: number
    source: 'native' | 'ip'
    altitude?: number | null
    altitudeAccuracy?: number | null
    heading?: number | null
    speed?: number | null
    timestamp: number
  }>
}

// TTS API 类型
interface MulbyTTS {
  speak(text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }): Promise<void>
  stop(): void
  pause(): void
  resume(): void
  getVoices(): { name: string; lang: string; default: boolean; localService: boolean }[]
  isSpeaking(): boolean
}

// Storage API 类型
interface MulbyStorage {
  get(key: string, namespace?: string): Promise<unknown>
  set(key: string, value: unknown, namespace?: string): Promise<void>
  remove(key: string, namespace?: string): Promise<void>
}

// HTTP API 类型
interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  data: string
}

interface MulbyHttp {
  request(options: {
    url: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
    headers?: Record<string, string>
    body?: unknown
    timeout?: number
  }): Promise<HttpResponse>
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>
  post(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse>
  put(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse>
  delete(url: string, headers?: Record<string, string>): Promise<HttpResponse>
}

// Filesystem API 类型
interface FileStat {
  name: string
  path: string
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}

interface MulbyFilesystem {
  readFile(path: string, encoding?: 'utf-8' | 'base64'): Promise<string | ArrayBuffer>
  writeFile(path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64'): Promise<void>
  exists(path: string): Promise<boolean>
  unlink(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
  mkdir(path: string): Promise<void>
  stat(path: string): Promise<FileStat | null>
  copy(src: string, dest: string): Promise<void>
  move(src: string, dest: string): Promise<void>
  extname(path: string): string
  dirname(path: string): string
  basename(path: string, ext?: string): string
  join(...paths: string[]): string
}

interface MulbyHost {
  invoke(pluginName: string, method: string, ...args: unknown[]): Promise<unknown>
  status(pluginName: string): Promise<{ ready: boolean; active: boolean }>
  restart(pluginName: string): Promise<boolean>
}

// FFmpeg API 类型
interface FFmpegRunProgress {
  bitrate: string
  fps: number
  frame: number
  percent?: number
  q: number | string
  size: string
  speed: string
  time: string
}

interface FFmpegDownloadProgress {
  phase: 'downloading' | 'extracting' | 'done'
  percent: number
  downloaded?: number
  total?: number
}

interface FFmpegTask {
  promise: Promise<void>
  kill(): void
  quit(): void
}

interface MulbyFFmpeg {
  isAvailable(): Promise<boolean>
  getVersion(): Promise<string | null>
  getPath(): Promise<string | null>
  download(onProgress?: (progress: FFmpegDownloadProgress) => void): Promise<{ success: boolean; error?: string }>
  run(args: string[], onProgress?: (progress: FFmpegRunProgress) => void): FFmpegTask
}

interface InputAttachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'image'
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  feature?: string
  input: string
  mode?: string
  route?: string
  attachments?: InputAttachment[]
}

interface MulbyAPI {
  clipboard: MulbyClipboard
  input: MulbyInput
  notification: MulbyNotification
  window: MulbyWindow
  subInput: MulbySubInput
  plugin: MulbyPlugin
  theme?: MulbyTheme
  screen: MulbyScreen
  shell: MulbyShell
  dialog: MulbyDialog
  system: MulbySystem
  permission: MulbyPermission
  shortcut: MulbyShortcut
  security: MulbySecurity
  media: MulbyMedia
  power: MulbyPower
  tray: MulbyTray
  network: MulbyNetwork
  menu: MulbyMenu
  geolocation: MulbyGeolocation
  tts: MulbyTTS
  storage: MulbyStorage
  http: MulbyHttp
  filesystem: MulbyFilesystem
  host?: MulbyHost
  onPluginInit(callback: (data: PluginInitData) => void): void
  onThemeChange?(callback: (theme: 'light' | 'dark') => void): void
  onWindowStateChange?(callback: (state: { isMaximized: boolean }) => void): void
  inbrowser: {
    goto: (url: string, headers?: Record<string, string>, timeout?: number) => any
    useragent: (ua: string) => any
    device: (name: string) => any
    viewport: (width: number, height: number) => any
    show: () => any
    hide: () => any
    evaluate: (func: string | Function, ...params: any[]) => any
    wait: (msOrSelector: number | string) => any
    click: (selector: string) => any
    mousedown: (selector: string) => any
    mouseup: (selector: string) => any
    scroll: (selector: string | number, y?: number) => any
    devTools: (mode?: 'right' | 'bottom' | 'undocked' | 'detach') => any
    paste: (text: string) => any
    file: (selector: string, payload: string | string[]) => any
    end: () => any
    // Missing methods
    type: (selector: string, text: string) => any
    press: (key: string, modifiers?: string[]) => any
    check: (selector: string, checked: boolean) => any
    value: (selector: string, val: string) => any
    focus: (selector: string) => any
    when: (selector: string | Function, ...params: any[]) => any
    css: (css: string) => any
    pdf: (options?: any, savePath?: string) => any
    cookies: (nameOrFilter?: string | any) => any
    clearCookies: (url?: string) => any
    input: (selectorOrText: string, text?: string) => any
    // New additions
    dblclick: (selector: string) => any
    hover: (selector: string) => any
    screenshot: (target?: any, savePath?: string) => any
    drop: (selector: string, payload: any) => any
    download: (urlOrFunc: string | Function, savePath?: string, ...params: any[]) => any
    removeCookies: (name: string) => any
    setCookies: (nameOrCookies: any, value?: string) => any
    markdown: (selector?: string) => any
    // Manager Methods
    getIdleInBrowsers: () => Promise<any[]>
    setInBrowserProxy: (config: any) => Promise<boolean>
    clearInBrowserCache: () => Promise<boolean>
    run: (idOrOptions?: number | any, options?: any) => Promise<any[]>
  }
  // Sharp 图像处理 API
  sharp: MulbySharpFunction
  getSharpVersion: () => Promise<{ sharp: Record<string, string>; format: Record<string, any> }>
  // FFmpeg 音视频处理 API
  ffmpeg: MulbyFFmpeg
}

/**
 * Sharp 图像处理代理接口
 */
interface MulbySharpProxy {
  // 尺寸调整
  resize(width?: number, height?: number, options?: object): MulbySharpProxy
  extend(options: object): MulbySharpProxy
  extract(options: { left: number; top: number; width: number; height: number }): MulbySharpProxy
  trim(options?: object): MulbySharpProxy

  // 变换
  rotate(angle?: number, options?: object): MulbySharpProxy
  flip(): MulbySharpProxy
  flop(): MulbySharpProxy

  // 图像处理
  blur(sigma?: number): MulbySharpProxy
  sharpen(options?: object): MulbySharpProxy
  flatten(options?: object): MulbySharpProxy
  gamma(gamma?: number): MulbySharpProxy
  negate(options?: object): MulbySharpProxy
  normalize(options?: object): MulbySharpProxy
  threshold(threshold?: number, options?: object): MulbySharpProxy
  modulate(options?: object): MulbySharpProxy

  // 颜色
  tint(color: string | object): MulbySharpProxy
  greyscale(greyscale?: boolean): MulbySharpProxy
  grayscale(grayscale?: boolean): MulbySharpProxy

  // 合成
  composite(images: object[]): MulbySharpProxy

  // 输出格式
  png(options?: object): MulbySharpProxy
  jpeg(options?: object): MulbySharpProxy
  webp(options?: object): MulbySharpProxy
  gif(options?: object): MulbySharpProxy
  tiff(options?: object): MulbySharpProxy
  avif(options?: object): MulbySharpProxy

  // 元数据
  withMetadata(options?: object): MulbySharpProxy

  // 其他
  clone(): MulbySharpProxy

  // 终结方法
  toBuffer(options?: object): Promise<ArrayBuffer>
  toFile(fileOut: string): Promise<{ format: string; width: number; height: number; channels: number; size: number }>
  metadata(): Promise<{ format?: string; width?: number; height?: number; channels?: number; space?: string; depth?: string; density?: number; hasAlpha?: boolean; orientation?: number }>
  stats(): Promise<object>
}

/**
 * Sharp 构造函数类型
 */
type MulbySharpFunction = (
  input?: string | ArrayBuffer | Uint8Array | object | any[],
  options?: object
) => MulbySharpProxy

declare global {
  interface Window {
    mulby: MulbyAPI
  }
}

export { }
