import { readFileSync } from 'fs'
import { join } from 'path'
import { VM } from 'vm2'
import { Plugin } from '../../shared/types/plugin'
import { createPluginAPI } from './api'

export class PluginRunner {
  private plugin: Plugin
  private vm: VM | null = null

  constructor(plugin: Plugin) {
    this.plugin = plugin
  }

  // 执行插件
  async run(): Promise<void> {
    const mainPath = join(this.plugin.path, this.plugin.manifest.main)
    const code = readFileSync(mainPath, 'utf-8')

    const api = createPluginAPI()
    const context = { api, text: '' }

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

    try {
      const pluginModule = this.vm.run(code + '\nmodule.exports')
      if (typeof pluginModule.run === 'function') {
        await pluginModule.run(context)
      }
    } catch (err) {
      console.error('Plugin execution error:', err)
      throw err
    }
  }
}
