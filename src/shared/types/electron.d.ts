export interface FileInfo {
  path: string
  name: string
  size: number
  type: string
  isDirectory: boolean
}

export interface PluginInfo {
  name: string
  displayName: string
  description: string
  icon?: string
  triggers: { type: string; value: string | string[]; description?: string }[]
  enabled: boolean
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
  plugin: {
    getAll: () => Promise<PluginInfo[]>
    search: (query: string) => Promise<PluginInfo[]>
    run: (name: string) => Promise<{ success: boolean; error?: string }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
