// 图标类型
export interface IconUrl {
  type: 'url'
  value: string
}

export interface IconSvg {
  type: 'svg'
  value: string
}

export interface IconFile {
  type: 'file'
  value?: string  // 相对路径，默认为 'icon.png'
}

export type PluginIconObject = IconUrl | IconSvg | IconFile

// 支持简写：字符串会自动解析为对应类型
export type PluginIcon = PluginIconObject | string

// 解析后的图标数据（传递给渲染进程）
export interface ResolvedIcon {
  type: 'url' | 'svg' | 'data-url'
  value: string
}

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

export type DynamicCmdInput = string | PluginCmd

export interface DynamicFeatureInput {
  code: string
  explain?: string
  icon?: string
  platform?: string | string[]
  mode?: 'ui' | 'silent' | 'detached'
  route?: string
  mainHide?: boolean
  mainPush?: boolean
  cmds: DynamicCmdInput[]
}

export interface DynamicFeature {
  code: string
  explain: string
  icon?: string
  platform?: string | string[]
  mode?: 'ui' | 'silent' | 'detached'
  route?: string
  mainHide?: boolean
  mainPush?: boolean
  cmds: PluginCmd[]
}

// 功能入口
export interface PluginFeature {
  code: string
  explain: string
  cmds: PluginCmd[]
  mode?: 'ui' | 'silent' | 'detached'
  route?: string
}

// 插件清单
export interface PluginManifest {
  id?: string  // 唯一标识符（推荐格式：@scope/name 或 com.example.name）
  name: string
  version: string
  displayName: string
  description: string
  main: string
  ui?: string  // UI 文件路径（可选）
  icon?: PluginIcon  // 插件图标（可选）
  features: PluginFeature[]
}

// 插件实例
export interface Plugin {
  id: string  // 解析后的唯一标识符（优先使用 manifest.id，否则使用 manifest.name）
  manifest: PluginManifest
  path: string
  enabled: boolean
  resolvedIcon?: ResolvedIcon  // 解析后的图标数据
}

// 插件生命周期钩子
export interface PluginHookContext {
  api: PluginAPI
}

export interface PluginLifecycleHooks {
  onLoad?: (context?: PluginHookContext) => void | Promise<void>
  onUnload?: (context?: PluginHookContext) => void | Promise<void>
  onEnable?: (context?: PluginHookContext) => void | Promise<void>
  onDisable?: (context?: PluginHookContext) => void | Promise<void>
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

// 剪贴板文件信息
export interface ClipboardFileInfo {
  path: string
  name: string
  size: number
  isDirectory: boolean
}

// 插件 API 类型
export interface PluginAPI {
  clipboard: {
    readText: () => string
    writeText: (text: string) => Promise<void>
    readImage: () => Buffer | null
    writeImage: (buffer: Buffer) => void
    readFiles: () => ClipboardFileInfo[]
    getFormat: () => 'text' | 'image' | 'files' | 'empty'
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
  http: {
    request: (options: HttpRequestOptions) => Promise<HttpResponse>
    get: (url: string, headers?: Record<string, string>) => Promise<HttpResponse>
    post: (url: string, body?: string | object, headers?: Record<string, string>) => Promise<HttpResponse>
    put: (url: string, body?: string | object, headers?: Record<string, string>) => Promise<HttpResponse>
    delete: (url: string, headers?: Record<string, string>) => Promise<HttpResponse>
  }
  features: {
    getFeatures: (codes?: string[]) => DynamicFeature[]
    setFeature: (feature: DynamicFeatureInput) => void
    removeFeature: (code: string) => boolean
    redirectHotKeySetting: (cmdLabel: string, autocopy?: boolean) => void
    redirectAiModelsSetting: () => void
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

// HTTP 请求选项
export interface HttpRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
  headers?: Record<string, string>
  body?: string | object
  timeout?: number
}

// HTTP 响应
export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  data: string
}
