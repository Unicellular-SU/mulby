export interface FileInfo {
  path: string
  name: string
  size: number
  type: string
  isDirectory: boolean
}

// 搜索结果项（功能入口）
export interface SearchResultItem {
  pluginName: string
  displayName: string
  featureCode: string
  featureExplain: string
  matchType: 'keyword' | 'regex'
}

export interface PluginInfo {
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
  }
  onPluginInit: (callback: (data: { pluginName: string; featureCode: string; input: string; mode?: string }) => void) => void
  onPluginAttach: (callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string }) => void) => void
  onPluginDetached: (callback: () => void) => void
}

declare global {
  interface Window {
    intools: ElectronAPI
  }
}

export {}
