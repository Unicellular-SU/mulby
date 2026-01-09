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
