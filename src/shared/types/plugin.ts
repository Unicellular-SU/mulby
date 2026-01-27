// 插件类型
export type PluginType =
  | 'utility'      // 实用工具（计算器、格式转换）
  | 'productivity' // 效率工具（剪贴板管理、快捷启动）
  | 'developer'    // 开发者工具（JSON 格式化、编码转换）
  | 'system'       // 系统工具（系统信息、进程管理）
  | 'media'        // 媒体工具（图片处理、视频转换）
  | 'network'      // 网络工具（API 测试、网络诊断）
  | 'ai'           // AI 工具（翻译、文本生成）
  | 'entertainment' // 休闲娱乐
  | 'other'        // 其他

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

export interface IconEmoji {
  type: 'emoji'
  value: string
}

export type PluginIconObject = IconUrl | IconSvg | IconFile | IconEmoji

// 支持简写：字符串会自动解析为对应类型
export type PluginIcon = PluginIconObject | string

// 解析后的图标数据（传递给渲染进程）
export interface ResolvedIcon {
  type: 'url' | 'svg' | 'data-url' | 'emoji'
  value: string
}

// 输入附件
export type InputAttachmentKind = 'file' | 'image'

export interface InputAttachment {
  id: string
  name: string
  size: number
  kind: InputAttachmentKind
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
}

export interface InputPayload {
  text: string
  attachments: InputAttachment[]
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
  label?: string       // 指令名称（显示在搜索结果中）
  minLength?: number   // 最少字符数
  maxLength?: number   // 最多字符数
}

// 文件类型过滤
export type FileType = 'file' | 'directory' | 'any'

export interface CmdFiles {
  type: 'files'
  exts?: string[]         // 文件扩展名（可选）
  fileType?: FileType     // 文件类型过滤（默认 'any'）
  match?: string          // 匹配文件(夹)名称的正则表达式（与 exts 二选一）
  minLength?: number      // 最少文件数
  maxLength?: number      // 最多文件数
}

export interface CmdImg {
  type: 'img'
  exts?: string[]
}

export interface CmdOver {
  type: 'over'
  label?: string       // 指令名称
  exclude?: string     // 排除的正则表达式
  minLength?: number   // 最少字符数
  maxLength?: number   // 最多字符数（默认 10000）
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
  icon?: PluginIcon     // 功能独立图标（支持路径/svg/网络链接）
  mainPush?: boolean    // 是否向搜索框推送内容
  mainHide?: boolean    // 触发该功能时不显示主窗口
}

// 独立窗口配置
export interface WindowOptions {
  width?: number       // 默认宽度
  height?: number      // 默认高度
  minWidth?: number    // 最小宽度
  minHeight?: number   // 最小高度
  maxWidth?: number    // 最大宽度
  maxHeight?: number   // 最大高度
}

// 插件行为设置
export interface PluginSetting {
  single?: boolean          // 是否单例模式运行（默认 true）
  height?: number           // 插件初始高度
  defaultDetached?: boolean // 是否默认以独立窗口运行（默认 false）
}

// 插件清单
export interface PluginManifest {
  id?: string  // 唯一标识符（推荐格式：@scope/name 或 com.example.name）
  name: string
  version: string
  type?: PluginType  // 插件类型
  author?: string
  homepage?: string
  displayName: string
  description: string
  main: string
  ui?: string  // UI 文件路径（可选）
  preload?: string  // 自定义 preload 脚本路径（可选）
  icon?: PluginIcon  // 插件图标（可选）
  features: PluginFeature[]
  window?: WindowOptions  // 独立窗口配置（可选）
  pluginSetting?: PluginSetting  // 插件行为设置（可选）
}

// 插件实例
export interface Plugin {
  id: string  // 解析后的唯一标识符（优先使用 manifest.id，否则使用 manifest.name）
  manifest: PluginManifest
  path: string
  enabled: boolean
  resolvedIcon?: ResolvedIcon  // 解析后的图标数据
  isDev?: boolean  // 是否为开发目录的插件
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
  attachments?: InputAttachment[]
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
