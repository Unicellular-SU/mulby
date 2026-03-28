import { join, dirname } from 'path'
import { readFileSync } from 'fs'
import { InputAttachment, Plugin, PluginModule } from '../../shared/types/plugin'
import { createPluginAPI } from './api'

/** 检测代码是否使用 ES Module 语法 */
function isESModule(code: string): boolean {
  const lines = code.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // 跳过注释
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue
    }
    // 检测 export 语句
    if (/^export\s+/.test(trimmed) || /^export\{/.test(trimmed)) {
      return true
    }
    // 检测顶层 import 语句（不是动态 import()）
    if (/^import\s+/.test(trimmed) && !trimmed.includes('import(')) {
      return true
    }
  }
  return false
}

/**
 * PluginRunner - 备用的主进程插件执行器
 * 
 * 注意：这是 useUtilityProcess = false 时的备用方案
 * 推荐使用 UtilityProcess (host-manager.ts) 进行进程隔离
 */
export class PluginRunner {
  private plugin: Plugin
  private pluginModule: PluginModule | null = null

  constructor(plugin: Plugin) {
    this.plugin = plugin
  }

  // 加载插件模块（支持 CommonJS 和 ES Module）
  private async loadModule(): Promise<PluginModule> {
    if (this.pluginModule) {
      return this.pluginModule
    }

    const mainPath = join(this.plugin.path, this.plugin.manifest.main)
    const code = readFileSync(mainPath, 'utf-8')

    // 检测模块格式
    if (isESModule(code)) {
      // ES Module 格式：使用动态 import()
      const cacheBuster = `?t=${Date.now()}`
      const module = await import(`file://${mainPath}${cacheBuster}`)
      this.pluginModule = module.default || module
    } else {
      // CommonJS 格式：使用 Module._compile() 加载
      const Module = require('module') as typeof import('module')
      const m = new (Module as any)(mainPath)
      m.filename = mainPath
      m.paths = (Module as any)._nodeModulePaths(dirname(mainPath))
      m._compile(code, mainPath)
      this.pluginModule = (m.exports.default || m.exports) as PluginModule
    }

    return this.pluginModule!
  }

  // 执行插件
  async run(featureCode: string, input?: string, attachments?: InputAttachment[]): Promise<void> {
    const pluginModule = await this.loadModule()
    const api = createPluginAPI(this.plugin.id, undefined, undefined, undefined, {
      runCommandAllowed: this.plugin.manifest.permissions?.runCommand === true
    })
    const context = { api, featureCode, input: input || '', attachments }

    try {
      if (typeof pluginModule.run === 'function') {
        await pluginModule.run(context)
      }
    } catch (err) {
      console.error('Plugin execution error:', err)
      throw err
    }
  }

  // 调用生命周期钩子
  async callHook(hookName: keyof PluginModule): Promise<void> {
    if (hookName === 'run') return

    try {
      const pluginModule = await this.loadModule()
      const hook = pluginModule[hookName]
      if (typeof hook === 'function') {
        await hook()
      }
    } catch (err) {
      console.error(`Plugin hook ${hookName} error:`, err)
    }
  }
}
