// InTools API 类型定义

interface ClipboardFileInfo {
  path: string
  name: string
  size: number
  isDirectory: boolean
}

interface IntoolsClipboard {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  readImage(): Promise<ArrayBuffer | null>
  writeImage(image: string | ArrayBuffer): Promise<void>
  readFiles(): Promise<ClipboardFileInfo[]>
  writeFiles(files: string | string[]): Promise<boolean>
  getFormat(): Promise<'text' | 'image' | 'files' | 'empty'>
}

interface IntoolsInput {
  hideMainWindowPasteText(text: string): Promise<boolean>
  hideMainWindowPasteImage(image: string | ArrayBuffer): Promise<boolean>
  hideMainWindowPasteFile(filePaths: string | string[]): Promise<boolean>
  hideMainWindowTypeString(text: string): Promise<boolean>
  simulateKeyboardTap(key: string, ...modifiers: string[]): Promise<boolean>
  simulateMouseMove(x: number, y: number): Promise<boolean>
  simulateMouseClick(x: number, y: number): Promise<boolean>
  simulateMouseDoubleClick(x: number, y: number): Promise<boolean>
  simulateMouseRightClick(x: number, y: number): Promise<boolean>
}

interface IntoolsNotification {
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

interface IntoolsWindow {
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
  sendToParent(channel: string, ...args: unknown[]): void
  onChildMessage(callback: (channel: string, ...args: unknown[]) => void): void
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): Promise<number>
  stopFindInPage(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  startDrag(filePath: string | string[]): void
}

interface IntoolsSubInput {
  set(placeholder?: string, isFocus?: boolean): Promise<boolean>
  remove(): Promise<boolean>
  setValue(text: string): void
  focus(): void
  blur(): void
  select(): void
  onChange(callback: (data: { text: string }) => void): void
}

interface IntoolsTheme {
  get(): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  set(mode: 'light' | 'dark' | 'system'): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  getActual(): Promise<'light' | 'dark'>
}

interface IntoolsPlugin {
  getAll(): Promise<any[]>
  search(query: string): Promise<any[]>
  run(name: string, featureCode: string, input?: string): Promise<any>
  install(filePath: string): Promise<any>
  enable(name: string): Promise<any>
  disable(name: string): Promise<any>
  uninstall(name: string): Promise<any>
  getReadme(name: string): Promise<string | null>
  redirect(label: string | [string, string], payload?: unknown): Promise<boolean | { candidates: { name: string; displayName: string }[] }>
  outPlugin(isKill?: boolean): Promise<boolean>
}

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

interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

interface IntoolsScreen {
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

interface IntoolsShell {
  openPath(path: string): Promise<string>
  openExternal(url: string): Promise<void>
  showItemInFolder(path: string): Promise<void>
  openFolder(path: string): Promise<string>
  trashItem(path: string): Promise<void>
  beep(): Promise<void>
}

interface IntoolsDialog {
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

interface IntoolsSystem {
  getSystemInfo(): Promise<SystemInfo>
  getAppInfo(): Promise<AppInfo>
  getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs'): Promise<string>
  getEnv(name: string): Promise<string | undefined>
  getIdleTime(): Promise<number>
  getFileIcon(filePath: string): Promise<string>
  getNativeId(): Promise<string>
  isDev(): Promise<boolean>
  isMacOS(): Promise<boolean>
  isWindows(): Promise<boolean>
  isLinux(): Promise<boolean>
}

interface IntoolsPermission {
  getStatus(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
  request(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
  canRequest(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<boolean>
  openSystemSettings(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<boolean>
  isAccessibilityTrusted(): Promise<boolean>
}

interface IntoolsShortcut {
  register(accelerator: string): Promise<boolean>
  unregister(accelerator: string): Promise<void>
  unregisterAll(): Promise<void>
  isRegistered(accelerator: string): Promise<boolean>
  onTriggered(callback: (accelerator: string) => void): void
}

interface IntoolsSecurity {
  isEncryptionAvailable(): Promise<boolean>
  encryptString(plainText: string): Promise<ArrayBuffer>
  decryptString(encrypted: ArrayBuffer): Promise<string>
}

interface IntoolsMedia {
  getAccessStatus(mediaType: 'microphone' | 'camera'): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  askForAccess(mediaType: 'microphone' | 'camera'): Promise<boolean>
  hasCameraAccess(): Promise<boolean>
  hasMicrophoneAccess(): Promise<boolean>
}

interface IntoolsPower {
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

interface IntoolsTray {
  create(options: { icon: string; tooltip?: string; title?: string }): Promise<boolean>
  destroy(): Promise<void>
  setIcon(icon: string): Promise<void>
  setTooltip(tooltip: string): Promise<void>
  setTitle(title: string): Promise<void>
  exists(): Promise<boolean>
}

interface IntoolsNetwork {
  isOnline(): Promise<boolean>
}

interface IntoolsMenu {
  showContextMenu(items: {
    label: string
    type?: 'normal' | 'separator' | 'checkbox' | 'radio'
    checked?: boolean
    enabled?: boolean
    id?: string
    submenu?: any[]
  }[]): Promise<string | null>
}

interface IntoolsGeolocation {
  getAccessStatus(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  requestAccess(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  canGetPosition(): Promise<boolean>
  openSettings(): Promise<void>
  getCurrentPosition(): Promise<{
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

interface IntoolsTTS {
  speak(text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }): Promise<void>
  stop(): void
  pause(): void
  resume(): void
  getVoices(): { name: string; lang: string; default: boolean; localService: boolean }[]
  isSpeaking(): boolean
}

interface IntoolsStorage {
  get(key: string, namespace?: string): Promise<unknown>
  set(key: string, value: unknown, namespace?: string): Promise<void>
  remove(key: string, namespace?: string): Promise<void>
}

interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  data: string
}

interface IntoolsHttp {
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

interface FileStat {
  name: string
  path: string
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}

interface IntoolsFilesystem {
  readFile(path: string, encoding?: 'utf-8' | 'base64'): Promise<string | ArrayBuffer>
  writeFile(path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64'): Promise<void>
  exists(path: string): Promise<boolean>
  unlink(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
  mkdir(path: string): Promise<void>
  stat(path: string): Promise<FileStat | null>
  copy(src: string, dest: string): Promise<void>
  move(src: string, dest: string): Promise<void>
}

interface IntoolsHost {
  invoke(pluginName: string, method: string, ...args: unknown[]): Promise<unknown>
  status(pluginName: string): Promise<{ ready: boolean; active: boolean }>
  restart(pluginName: string): Promise<boolean>
}

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

interface IntoolsFFmpeg {
  isAvailable(): Promise<boolean>
  getVersion(): Promise<string | null>
  getPath(): Promise<string | null>
  download(onProgress?: (progress: FFmpegDownloadProgress) => void): Promise<{ success: boolean; error?: string }>
  run(args: string[], onProgress?: (progress: FFmpegRunProgress) => void): FFmpegTask
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  feature?: string
  input: string
  mode?: string
  route?: string
}

interface IntoolsAPI {
  clipboard: IntoolsClipboard
  input: IntoolsInput
  notification: IntoolsNotification
  window: IntoolsWindow
  subInput: IntoolsSubInput
  plugin: IntoolsPlugin
  theme?: IntoolsTheme
  screen: IntoolsScreen
  shell: IntoolsShell
  dialog: IntoolsDialog
  system: IntoolsSystem
  permission: IntoolsPermission
  shortcut: IntoolsShortcut
  security: IntoolsSecurity
  media: IntoolsMedia
  power: IntoolsPower
  tray: IntoolsTray
  network: IntoolsNetwork
  menu: IntoolsMenu
  geolocation: IntoolsGeolocation
  tts: IntoolsTTS
  storage: IntoolsStorage
  http: IntoolsHttp
  filesystem: IntoolsFilesystem
  host?: IntoolsHost
  onPluginInit(callback: (data: PluginInitData) => void): void
  onPluginAttach?(callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string; preloadPath: string }) => void): void
  onPluginDetached?(callback: () => void): void
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
    dblclick: (selector: string) => any
    hover: (selector: string) => any
    screenshot: (target?: any, savePath?: string) => any
    drop: (selector: string, payload: any) => any
    download: (urlOrFunc: string | Function, savePath?: string, ...params: any[]) => any
    removeCookies: (name: string) => any
    setCookies: (nameOrCookies: any, value?: string) => any
    markdown: (selector?: string) => any
    getIdleInBrowsers: () => Promise<any[]>
    setInBrowserProxy: (config: any) => Promise<boolean>
    clearInBrowserCache: () => Promise<boolean>
    run: (idOrOptions?: number | any, options?: any) => Promise<any[]>
  }
  sharp: IntoolsSharpFunction
  getSharpVersion: () => Promise<{ sharp: Record<string, string>; format: Record<string, any> }>
  ffmpeg: IntoolsFFmpeg
}

interface IntoolsSharpProxy {
  resize(width?: number, height?: number, options?: object): IntoolsSharpProxy
  extend(options: object): IntoolsSharpProxy
  extract(options: { left: number; top: number; width: number; height: number }): IntoolsSharpProxy
  trim(options?: object): IntoolsSharpProxy
  rotate(angle?: number, options?: object): IntoolsSharpProxy
  flip(): IntoolsSharpProxy
  flop(): IntoolsSharpProxy
  blur(sigma?: number): IntoolsSharpProxy
  sharpen(options?: object): IntoolsSharpProxy
  flatten(options?: object): IntoolsSharpProxy
  gamma(gamma?: number): IntoolsSharpProxy
  negate(options?: object): IntoolsSharpProxy
  normalize(options?: object): IntoolsSharpProxy
  threshold(threshold?: number, options?: object): IntoolsSharpProxy
  modulate(options?: object): IntoolsSharpProxy
  tint(color: string | object): IntoolsSharpProxy
  greyscale(greyscale?: boolean): IntoolsSharpProxy
  grayscale(grayscale?: boolean): IntoolsSharpProxy
  composite(images: object[]): IntoolsSharpProxy
  png(options?: object): IntoolsSharpProxy
  jpeg(options?: object): IntoolsSharpProxy
  webp(options?: object): IntoolsSharpProxy
  gif(options?: object): IntoolsSharpProxy
  tiff(options?: object): IntoolsSharpProxy
  avif(options?: object): IntoolsSharpProxy
  withMetadata(options?: object): IntoolsSharpProxy
  clone(): IntoolsSharpProxy
  toBuffer(options?: object): Promise<ArrayBuffer>
  toFile(fileOut: string): Promise<{ format: string; width: number; height: number; channels: number; size: number }>
  metadata(): Promise<{ format?: string; width?: number; height?: number; channels?: number; space?: string; depth?: string; density?: number; hasAlpha?: boolean; orientation?: number }>
  stats(): Promise<object>
}

type IntoolsSharpFunction = (
  input?: string | ArrayBuffer | Uint8Array | object | any[],
  options?: object
) => IntoolsSharpProxy

declare global {
  interface Window {
    intools: IntoolsAPI
  }
}

export {}
