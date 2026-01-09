// 插件触发器类型
export interface PluginTrigger {
  type: 'keyword' | 'regex' | 'file'
  value: string | string[]
  description?: string
}

// 插件清单
export interface PluginManifest {
  name: string
  version: string
  displayName: string
  description: string
  author?: string
  runtime: 'nodejs' | 'python'
  main: string
  ui?: string
  icon?: string
  permissions: string[]
  triggers: PluginTrigger[]
  shortcut?: string
}

// 插件实例
export interface Plugin {
  manifest: PluginManifest
  path: string
  enabled: boolean
}
