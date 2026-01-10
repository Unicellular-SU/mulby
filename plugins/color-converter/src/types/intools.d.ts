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
  writeImage(buffer: ArrayBuffer): Promise<void>
  readFiles(): Promise<ClipboardFileInfo[]>
  getFormat(): Promise<'text' | 'image' | 'files' | 'empty'>
}

interface IntoolsNotification {
  show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void
}

interface IntoolsWindow {
  hide(): void
  setSize(width: number, height: number): void
  center(): void
}

interface IntoolsTheme {
  get(): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  getActual(): Promise<'light' | 'dark'>
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
}

interface IntoolsAPI {
  clipboard: IntoolsClipboard
  notification: IntoolsNotification
  window: IntoolsWindow
  theme?: IntoolsTheme
  onPluginInit(callback: (data: PluginInitData) => void): void
  onThemeChange?(callback: (theme: 'light' | 'dark') => void): void
}

declare global {
  interface Window {
    intools: IntoolsAPI
  }
}

export {}
