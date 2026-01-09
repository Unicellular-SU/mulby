import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { PluginLoader } from './loader'
import { PluginRunner } from './runner'
import { Plugin } from '../../shared/types/plugin'

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map()

  constructor() {}

  // 初始化：加载所有插件
  init() {
    // 用户数据目录的插件
    const userPluginsDir = join(app.getPath('userData'), 'plugins')
    // 开发目录的插件（项目根目录）
    const devPluginsDir = join(process.cwd(), 'plugins')

    const dirs = [userPluginsDir, devPluginsDir].filter(d => existsSync(d))

    for (const dir of dirs) {
      const loader = new PluginLoader(dir)
      const plugins = loader.loadAll()
      for (const plugin of plugins) {
        this.plugins.set(plugin.manifest.name, plugin)
      }
    }

    console.log(`Loaded ${this.plugins.size} plugins from: ${dirs.join(', ')}`)
  }

  // 获取所有插件
  getAll(): Plugin[] {
    return Array.from(this.plugins.values())
  }

  // 根据名称获取插件
  get(name: string): Plugin | undefined {
    return this.plugins.get(name)
  }

  // 搜索插件
  search(query: string): Plugin[] {
    if (!query) return this.getAll()
    const q = query.toLowerCase()
    return this.getAll().filter(p => {
      const m = p.manifest
      // 匹配名称或关键词
      if (m.displayName.toLowerCase().includes(q)) return true
      if (m.name.includes(q)) return true
      // 匹配触发器关键词
      for (const trigger of m.triggers) {
        if (trigger.type === 'keyword' && trigger.value.toString().includes(q)) {
          return true
        }
      }
      return false
    })
  }

  // 执行插件
  async run(name: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      return { success: false, error: 'Plugin not found' }
    }

    try {
      const runner = new PluginRunner(plugin)
      await runner.run()
      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error }
    }
  }
}
