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
  writeImage(buffer: ArrayBuffer): Promise<void>
  readFiles(): Promise<ClipboardFileInfo[]>
  getFormat(): Promise<'text' | 'image' | 'files' | 'empty'>
}

interface MulbyNotification {
  show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void
}

interface MulbyWindow {
  hide(): void
  setSize(width: number, height: number): void
  center(): void
}

interface MulbyTheme {
  get(): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  getActual(): Promise<'light' | 'dark'>
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
}

interface MulbyAPI {
  clipboard: MulbyClipboard
  notification: MulbyNotification
  window: MulbyWindow
  theme?: MulbyTheme
  onPluginInit(callback: (data: PluginInitData) => void): void
  onThemeChange?(callback: (theme: 'light' | 'dark') => void): void
}

declare global {
  interface Window {
    mulby: MulbyAPI
  }
}

export {}
