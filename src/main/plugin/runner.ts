import { readFileSync } from 'fs'
import { join } from 'path'
import { VM } from 'vm2'
import { Plugin, PluginModule } from '../../shared/types/plugin'
import { createPluginAPI } from './api'

export class PluginRunner {
  private plugin: Plugin
  private vm: VM | null = null
  private pluginModule: PluginModule | null = null

  constructor(plugin: Plugin) {
    this.plugin = plugin
  }

  // 加载插件模块
  private loadModule(): PluginModule {
    if (this.pluginModule) {
      return this.pluginModule
    }

    const mainPath = join(this.plugin.path, this.plugin.manifest.main)
    const code = readFileSync(mainPath, 'utf-8')

    this.vm = new VM({
      timeout: 5000,
      sandbox: {
        module: { exports: {} },
        exports: {},
        require: () => null,
        console,
        Buffer
      }
    })

    this.pluginModule = this.vm.run(code + '\nmodule.exports') as PluginModule
    return this.pluginModule
  }

  // 执行插件
  async run(featureCode: string, input?: string): Promise<void> {
    const pluginModule = this.loadModule()
    const api = createPluginAPI(this.plugin.id)
    const context = { api, featureCode, input: input || '' }

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
      const pluginModule = this.loadModule()
      const hook = pluginModule[hookName]
      if (typeof hook === 'function') {
        await hook()
      }
    } catch (err) {
      console.error(`Plugin hook ${hookName} error:`, err)
    }
  }
}
