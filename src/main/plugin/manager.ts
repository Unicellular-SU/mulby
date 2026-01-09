import { app } from 'electron'
import { join } from 'path'
import { PluginLoader } from './loader'
import { Plugin } from '../../shared/types/plugin'

export class PluginManager {
  private loader: PluginLoader
  private plugins: Map<string, Plugin> = new Map()

  constructor() {
    const pluginsDir = join(app.getPath('userData'), 'plugins')
    this.loader = new PluginLoader(pluginsDir)
  }

  // 初始化：加载所有插件
  init() {
    const plugins = this.loader.loadAll()
    for (const plugin of plugins) {
      this.plugins.set(plugin.manifest.name, plugin)
    }
    console.log(`Loaded ${this.plugins.size} plugins`)
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
}
