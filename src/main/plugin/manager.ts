import { app } from 'electron'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { PluginLoader } from './loader'
import { PluginRunner } from './runner'
import { PluginStateManager } from './state'
import { PluginWindowManager } from './window'
import { Plugin, PluginFeature } from '../../shared/types/plugin'

// 搜索结果项
interface SearchResult {
  plugin: Plugin
  feature: PluginFeature
  matchType: 'keyword' | 'regex'
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private runners: Map<string, PluginRunner> = new Map()
  private stateManager: PluginStateManager
  private windowManager: PluginWindowManager

  constructor() {
    this.stateManager = new PluginStateManager()
    this.windowManager = new PluginWindowManager()
  }

  // 初始化：加载所有插件
  async init() {
    // 清理旧数据
    this.plugins.clear()
    this.runners.clear()

    // 用户数据目录的插件
    const userPluginsDir = join(app.getPath('userData'), 'plugins')
    // 开发目录的插件（项目根目录）
    const devPluginsDir = join(process.cwd(), 'plugins')

    const dirs = [userPluginsDir, devPluginsDir].filter(d => existsSync(d))

    for (const dir of dirs) {
      const loader = new PluginLoader(dir)
      const plugins = loader.loadAll()
      for (const plugin of plugins) {
        // 应用持久化的状态
        const state = this.stateManager.getPluginState(plugin.manifest.name)
        plugin.enabled = state.enabled

        this.plugins.set(plugin.manifest.name, plugin)

        // 调用 onLoad 钩子
        if (plugin.enabled) {
          await this.callPluginHook(plugin, 'onLoad')
        }
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

  // 获取启用的插件
  getEnabled(): Plugin[] {
    return this.getAll().filter(p => p.enabled)
  }

  // 搜索插件（返回匹配的功能入口，只搜索启用的插件）
  search(query: string): SearchResult[] {
    const enabledPlugins = this.getEnabled()

    if (!query) {
      return enabledPlugins.map(p => ({
        plugin: p,
        feature: p.manifest.features[0],
        matchType: 'keyword' as const
      }))
    }

    const results: SearchResult[] = []
    const q = query.toLowerCase()

    for (const plugin of enabledPlugins) {
      for (const feature of plugin.manifest.features) {
        for (const cmd of feature.cmds) {
          if (cmd.type === 'regex') {
            try {
              const regex = new RegExp(cmd.match)
              if (regex.test(query)) {
                results.push({ plugin, feature, matchType: 'regex' })
                break
              }
            } catch {}
          }
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
  async run(name: string, featureCode: string, input?: string): Promise<{ success: boolean; hasUI?: boolean; error?: string }> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      return { success: false, error: 'Plugin not found' }
    }
    if (!plugin.enabled) {
      return { success: false, error: 'Plugin is disabled' }
    }

    // 如果插件有 UI，打开 UI 窗口
    if (plugin.manifest.ui) {
      const win = this.windowManager.openWindow(plugin, featureCode, input)
      return { success: !!win, hasUI: true }
    }

    // 无 UI 插件，直接执行
    try {
      const runner = this.getRunner(plugin)
      await runner.run(featureCode, input)
      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error }
    }
  }

  // 获取或创建 PluginRunner
  private getRunner(plugin: Plugin): PluginRunner {
    let runner = this.runners.get(plugin.manifest.name)
    if (!runner) {
      runner = new PluginRunner(plugin)
      this.runners.set(plugin.manifest.name, runner)
    }
    return runner
  }

  // 调用插件生命周期钩子
  private async callPluginHook(plugin: Plugin, hookName: 'onLoad' | 'onUnload' | 'onEnable' | 'onDisable'): Promise<void> {
    try {
      const runner = this.getRunner(plugin)
      await runner.callHook(hookName)
    } catch (err) {
      console.error(`Failed to call ${hookName} for plugin ${plugin.manifest.name}:`, err)
    }
  }

  // 启用插件
  async enable(name: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }
    if (plugin.enabled) {
      return { success: true }
    }

    plugin.enabled = true
    this.stateManager.setEnabled(name, true)
    await this.callPluginHook(plugin, 'onEnable')

    return { success: true }
  }

  // 禁用插件
  async disable(name: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }
    if (!plugin.enabled) {
      return { success: true }
    }

    await this.callPluginHook(plugin, 'onDisable')
    plugin.enabled = false
    this.stateManager.setEnabled(name, false)

    return { success: true }
  }

  // 卸载插件
  async uninstall(name: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }

    try {
      // 调用 onUnload 钩子
      await this.callPluginHook(plugin, 'onUnload')

      // 删除插件文件
      rmSync(plugin.path, { recursive: true, force: true })

      // 清理内存
      this.plugins.delete(name)
      this.runners.delete(name)
      this.stateManager.removePluginState(name)

      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : '卸载失败'
      return { success: false, error }
    }
  }
}
