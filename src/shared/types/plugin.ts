// 命令类型
export interface CmdKeyword {
  type: 'keyword'
  value: string
}

export interface CmdRegex {
  type: 'regex'
  match: string
  explain?: string
}

export interface CmdFiles {
  type: 'files'
  exts: string[]
}

export interface CmdImg {
  type: 'img'
}

export interface CmdOver {
  type: 'over'
}

export type PluginCmd = CmdKeyword | CmdRegex | CmdFiles | CmdImg | CmdOver

// 功能入口
export interface PluginFeature {
  code: string
  explain: string
  cmds: PluginCmd[]
}

// 插件清单
export interface PluginManifest {
  name: string
  version: string
  displayName: string
  description: string
  main: string
  features: PluginFeature[]
}

// 插件实例
export interface Plugin {
  manifest: PluginManifest
  path: string
  enabled: boolean
}

// 插件生命周期钩子
export interface PluginLifecycleHooks {
  onLoad?: () => void | Promise<void>
  onUnload?: () => void | Promise<void>
  onEnable?: () => void | Promise<void>
  onDisable?: () => void | Promise<void>
}

// 插件模块导出
export interface PluginModule extends PluginLifecycleHooks {
  run: (context: PluginContext) => void | Promise<void>
}

// 插件执行上下文
export interface PluginContext {
  api: PluginAPI
  featureCode: string
  input: string
}

// 插件 API 类型
export interface PluginAPI {
  clipboard: {
    readText: () => string
    writeText: (text: string) => Promise<void>
  }
  notification: {
    show: (message: string, type?: string) => void
  }
  storage: {
    get: (key: string) => unknown
    set: (key: string, value: unknown) => void
    remove: (key: string) => void
    clear: () => void
    keys: () => string[]
  }
  filesystem: {
    readFile: (path: string, encoding?: 'utf-8' | 'base64') => string | Buffer
    writeFile: (path: string, data: string | Buffer, encoding?: 'utf-8' | 'base64') => void
    exists: (path: string) => boolean
    unlink: (path: string) => void
    readdir: (path: string) => string[]
    mkdir: (path: string) => void
    stat: (path: string) => FileStat | null
    copy: (src: string, dest: string) => void
    move: (src: string, dest: string) => void
    extname: (path: string) => string
    join: (...paths: string[]) => string
    dirname: (path: string) => string
    basename: (path: string, ext?: string) => string
  }
}

// 插件状态配置
export interface PluginStateConfig {
  [pluginName: string]: {
    enabled: boolean
    installedAt?: number
    updatedAt?: number
  }
}

// 文件信息
export interface FileStat {
  name: string
  path: string
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}
