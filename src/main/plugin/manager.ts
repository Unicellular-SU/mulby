import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { PluginLoader } from './loader'
import { PluginRunner } from './runner'
import { Plugin, PluginFeature } from '../../shared/types/plugin'

// 搜索结果项
interface SearchResult {
  plugin: Plugin
  feature: PluginFeature
  matchType: 'keyword' | 'regex'
}

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

  // 搜索插件（返回匹配的功能入口）
  search(query: string): SearchResult[] {
    if (!query) {
      // 无输入时返回所有插件的第一个功能
      return this.getAll().map(p => ({
        plugin: p,
        feature: p.manifest.features[0],
        matchType: 'keyword' as const
      }))
    }

    const results: SearchResult[] = []
    const q = query.toLowerCase()

    for (const plugin of this.getAll()) {
      for (const feature of plugin.manifest.features) {
        for (const cmd of feature.cmds) {
          // 1. 正则匹配（优先，用于内容格式检测）
          if (cmd.type === 'regex') {
            try {
              const regex = new RegExp(cmd.match)
              if (regex.test(query)) {
                results.push({ plugin, feature, matchType: 'regex' })
                break
              }
            } catch {}
          }
          // 2. 关键词匹配
          if (cmd.type === 'keyword' && cmd.value.toLowerCase().includes(q)) {
            results.push({ plugin, feature, matchType: 'keyword' })
            break
          }
        }
      }
    }

    return results
  }

  // 执行插件
  async run(name: string, featureCode: string, input?: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      return { success: false, error: 'Plugin not found' }
    }

    try {
      const runner = new PluginRunner(plugin)
      await runner.run(featureCode, input)
      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error }
    }
  }
}
