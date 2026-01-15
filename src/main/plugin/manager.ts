import { app } from 'electron'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { PluginLoader } from './loader'
import { PluginRunner } from './runner'
import { PluginStateManager } from './state'
import { PluginWindowManager } from './window'
import { PluginHostManager } from './host-manager'
import { pluginFeatureStore } from './dynamic-features'
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
  private windowManager: PluginWindowManager | null = null
  private hostManager: PluginHostManager
  private useUtilityProcess: boolean = true  // 是否使用 UtilityProcess
  private initializedPlugins: Set<string> = new Set()  // 已初始化的插件（懒加载跟踪）

  constructor() {
    this.stateManager = new PluginStateManager()
    this.hostManager = new PluginHostManager()
  }

  // 设置窗口管理器
  setWindowManager(windowManager: PluginWindowManager) {
    this.windowManager = windowManager
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
        // 检测 ID 冲突
        if (this.plugins.has(plugin.id)) {
          const existing = this.plugins.get(plugin.id)!
          console.warn(
            `[PluginManager] ID conflict detected: "${plugin.id}"\n` +
            `  - Existing: ${existing.path}\n` +
            `  - Skipped:  ${plugin.path}\n` +
            `  Consider adding unique "id" field to manifest.json`
          )
          continue  // 跳过冲突的插件
        }

        // 应用持久化的状态
        const state = this.stateManager.getPluginState(plugin.id)
        plugin.enabled = state.enabled

        this.plugins.set(plugin.id, plugin)
        // 注意：不在这里调用 onLoad 钩子
        // UtilityProcess 采用懒加载，只有在插件首次运行时才创建
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

  // 获取插件所有功能入口（包含动态指令）
  getFeatures(name: string): PluginFeature[] {
    const plugin = this.plugins.get(name)
    if (!plugin) return []
    return this.getCombinedFeatures(plugin)
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
      for (const feature of this.getCombinedFeatures(plugin)) {
        for (const cmd of feature.cmds) {
          if (cmd.type === 'regex') {
            try {
              const regex = new RegExp(cmd.match)
              if (regex.test(query)) {
                results.push({ plugin, feature, matchType: 'regex' })
                break
              }
            } catch { }
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

    // 懒加载：首次运行时调用 onLoad 钩子
    if (!this.initializedPlugins.has(name)) {
      await this.callPluginHook(plugin, 'onLoad')
      this.initializedPlugins.add(name)
    }

    // 如果插件有 UI，打开 UI 窗口
    if (plugin.manifest.ui) {
      if (!this.windowManager) {
        return { success: false, error: 'Window manager not initialized' }
      }
      const success = this.windowManager.attachPlugin(plugin, featureCode, input)
      return { success, hasUI: true }
    }

    // 无 UI 插件，使用 UtilityProcess 或 VM2 执行
    try {
      if (this.useUtilityProcess) {
        await this.hostManager.runPlugin(plugin, featureCode, input || '')
      } else {
        const runner = this.getRunner(plugin)
        await runner.run(featureCode, input)
      }
      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error }
    }
  }

  // 获取或创建 PluginRunner
  private getRunner(plugin: Plugin): PluginRunner {
    let runner = this.runners.get(plugin.id)
    if (!runner) {
      runner = new PluginRunner(plugin)
      this.runners.set(plugin.id, runner)
    }
    return runner
  }

  // 调用插件生命周期钩子
  private async callPluginHook(plugin: Plugin, hookName: 'onLoad' | 'onUnload' | 'onEnable' | 'onDisable'): Promise<void> {
    try {
      if (this.useUtilityProcess) {
        await this.hostManager.callHook(plugin, hookName)
      } else {
        const runner = this.getRunner(plugin)
        await runner.callHook(hookName)
      }
    } catch (err) {
      console.error(`Failed to call ${hookName} for plugin ${plugin.id}:`, err)
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

    // 只有已初始化的插件才调用 onEnable 钩子
    if (this.initializedPlugins.has(name)) {
      await this.callPluginHook(plugin, 'onEnable')
    }

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

    // 只有已初始化的插件才调用钩子
    if (this.initializedPlugins.has(name)) {
      await this.callPluginHook(plugin, 'onDisable')
      // 销毁 Host 进程
      if (this.useUtilityProcess) {
        await this.hostManager.destroyHost(name)
      }
      this.initializedPlugins.delete(name)
    }

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
      // 只有已初始化的插件才调用钩子和销毁 Host
      if (this.initializedPlugins.has(name)) {
        await this.callPluginHook(plugin, 'onUnload')
        if (this.useUtilityProcess) {
          await this.hostManager.destroyHost(name)
        }
        this.initializedPlugins.delete(name)
      }

      // 删除插件文件
      rmSync(plugin.path, { recursive: true, force: true })

      // 清理内存
      this.plugins.delete(name)
      this.runners.delete(name)
      this.stateManager.removePluginState(name)
      pluginFeatureStore.clearFeatures(name)

      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : '卸载失败'
      return { success: false, error }
    }
  }

  // 获取插件 README
  getReadme(name: string): string | null {
    const plugin = this.plugins.get(name)
    if (!plugin) return null

    const readmePath = join(plugin.path, 'README.md')
    if (existsSync(readmePath)) {
      try {
        return require('fs').readFileSync(readmePath, 'utf-8')
      } catch (err) {
        console.error(`Failed to read README for plugin ${name}:`, err)
        return null
      }
    }
    return null
  }

  // 获取 HostManager 实例
  getHostManager(): PluginHostManager {
    return this.hostManager
  }

  // 首次安装后主动初始化插件（触发 onLoad）
  async initializePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name) || this.getAll().find(p => p.manifest.name === name)
    if (!plugin) return
    if (this.initializedPlugins.has(plugin.id)) return
    await this.callPluginHook(plugin, 'onLoad')
    this.initializedPlugins.add(plugin.id)
  }

  // 销毁所有资源
  async destroy(): Promise<void> {
    // 销毁所有 Host 进程
    await this.hostManager.destroyAll()

    // 清理内存
    this.plugins.clear()
    this.runners.clear()
    this.initializedPlugins.clear()
  }

  private getCombinedFeatures(plugin: Plugin): PluginFeature[] {
    const dynamicFeatures = pluginFeatureStore.getPluginFeatures(plugin.id)
    const dynamicCodes = new Set(dynamicFeatures.map(feature => feature.code))
    const staticFeatures = plugin.manifest.features.filter(feature => !dynamicCodes.has(feature.code))
    return [...staticFeatures, ...dynamicFeatures]
  }
}
