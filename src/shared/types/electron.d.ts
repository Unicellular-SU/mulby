export interface FileInfo {
  path: string
  name: string
  size: number
  type: string
  isDirectory: boolean
}

export interface ElectronAPI {
  window: {
    hide: () => void
    setSize: (width: number, height: number) => void
    center: () => void
  }
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
