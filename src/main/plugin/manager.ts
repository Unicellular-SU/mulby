import { app } from 'electron'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { PluginLoader } from './loader'
import { PluginRunner } from './runner'
import { PluginStateManager } from './state'
import { PluginWindowManager } from './window'
import { PluginHostManager } from './host-manager'
import { pluginFeatureStore } from './dynamic-features'
import { InputPayload, Plugin, PluginFeature } from '../../shared/types/plugin'
import { PluginSearchWorker } from './search-worker-manager'
import { filterAttachmentsByCmd, findBestMatch, normalizeInputPayload } from '../../shared/search-matcher'
import type { MatchType } from '../../shared/search-matcher'

// 搜索结果项
interface SearchResult {
  plugin: Plugin
  feature: PluginFeature
  matchType: MatchType
}


export class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private runners: Map<string, PluginRunner> = new Map()
  private stateManager: PluginStateManager
  private windowManager: PluginWindowManager | null = null
  private hostManager: PluginHostManager
  private useUtilityProcess: boolean = true  // 是否使用 UtilityProcess
  private initializedPlugins: Set<string> = new Set()  // 已初始化的插件（懒加载跟踪）
  private searchWorker: PluginSearchWorker

  constructor() {
    this.stateManager = new PluginStateManager()
    this.hostManager = new PluginHostManager()
    this.searchWorker = new PluginSearchWorker()
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

    // 动态导入设置管理器，避免循环依赖
    const { appSettingsManager } = await import('../services/app-settings')
    const settings = appSettingsManager.getSettings()
    const developer = settings.developer

    // 用户数据目录的插件（已安装）
    const userPluginsDir = join(app.getPath('userData'), 'plugins')

    // 开发目录的插件（项目根目录，仅在开发模式下有效）
    const devPluginsDir = join(process.cwd(), 'plugins')

    // 用户自定义的开发目录（开发者模式启用时生效）
    const customDevDirs = developer.enabled ? developer.pluginPaths : []

    const dirs = [
      userPluginsDir,
      ...(app.isPackaged ? [] : [devPluginsDir]),  // 打包后不从 cwd/plugins 加载
      ...customDevDirs.filter(d => existsSync(d))   // 自定义的开发目录
    ].filter(d => existsSync(d))

    // 记录开发目录，用于标记开发插件
    const devDirs = new Set([
      ...(app.isPackaged ? [] : [devPluginsDir]),
      ...customDevDirs
    ])

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

        // 标记开发中的插件
        plugin.isDev = Array.from(devDirs).some(devDir => plugin.path.startsWith(devDir))

        // 应用持久化的状态
        const state = this.stateManager.getPluginState(plugin.id)
        plugin.enabled = state.enabled

        this.plugins.set(plugin.id, plugin)

        // 如果是开发模式插件，启动文件监听
        if (plugin.isDev && plugin.enabled) {
          this.setupPluginWatcher(plugin)
        }

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
  async search(input: string | InputPayload): Promise<SearchResult[]> {
    const enabledPlugins = this.getEnabled()

    const normalizedInput = normalizeInputPayload(input)
    const text = normalizedInput.text
    const attachments = normalizedInput.attachments
    const hasText = text.trim().length > 0
    const hasAttachments = attachments.length > 0

    if (!hasText && !hasAttachments) {
      return enabledPlugins.map(p => ({
        plugin: p,
        feature: p.manifest.features[0],
        matchType: 'keyword' as const
      }))
    }

    try {
      const pluginData = enabledPlugins.map((plugin) => ({
        pluginId: plugin.id,
        features: this.getCombinedFeatures(plugin).map((feature) => ({
          code: feature.code,
          cmds: feature.cmds
        }))
      }))
      const matches = await this.searchWorker.search(normalizedInput, pluginData)
      return matches
        .map((match) => {
          const plugin = this.plugins.get(match.pluginId)
          if (!plugin) return null
          const feature = this.getCombinedFeatures(plugin).find((item) => item.code === match.featureCode)
          if (!feature) return null
          return { plugin, feature, matchType: match.matchType }
        })
        .filter((item): item is SearchResult => Boolean(item))
    } catch (error) {
      console.warn('[PluginManager] Search worker failed, falling back to main process search', error)
      const results: SearchResult[] = []
      for (const plugin of enabledPlugins) {
        for (const feature of this.getCombinedFeatures(plugin)) {
          const match = findBestMatch(feature, normalizedInput)
          if (match) {
            results.push({ plugin, feature, matchType: match.matchType })
          }
        }
      }
      return results
    }
  }

  // 执行插件
  async run(
    name: string,
    featureCode: string,
    input?: string | InputPayload
  ): Promise<{ success: boolean; hasUI?: boolean; error?: string }> {
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

    const feature = this.getCombinedFeatures(plugin).find(item => item.code === featureCode)
    const normalizedInput = normalizeInputPayload(input)
    const matched = feature ? findBestMatch(feature, normalizedInput) : null
    const filteredAttachments = filterAttachmentsByCmd(normalizedInput.attachments, matched?.cmd)
    const resolvedInput: InputPayload = {
      text: normalizedInput.text,
      attachments: filteredAttachments
    }
    const useUI = Boolean(plugin.manifest.ui) && feature?.mode !== 'silent'
    const useDetached = feature?.mode === 'detached'
    const route = feature?.route
    const shouldHideMain = feature?.mainHide === true

    // 如果 mainHide 为 true，隐藏主窗口
    if (shouldHideMain && this.windowManager) {
      this.windowManager.hidePanelWindow()
    }

    // 如果插件有 UI 且非静默指令，打开 UI 窗口
    if (useUI) {
      if (!this.windowManager) {
        return { success: false, error: 'Window manager not initialized' }
      }
      if (useDetached) {
        const win = this.windowManager.createDetachedWindow(plugin, featureCode, resolvedInput, route)
        return { success: Boolean(win), hasUI: true }
      }
      const success = this.windowManager.attachPlugin(plugin, featureCode, resolvedInput, route)
      return { success, hasUI: true }
    }

    // 无 UI 插件，使用 UtilityProcess 或 VM2 执行
    try {
      if (this.useUtilityProcess) {
        await this.hostManager.runPlugin(plugin, featureCode, resolvedInput.text, resolvedInput.attachments)
      } else {
        const runner = this.getRunner(plugin)
        await runner.run(featureCode, resolvedInput.text, resolvedInput.attachments)
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

    // 如果是开发插件，启用监听
    if (plugin.isDev) {
      this.setupPluginWatcher(plugin)
    }

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

    // 停止文件监听
    this.stopPluginWatcher(name)

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
      // 停止监听
      this.stopPluginWatcher(name)

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
    // 停止所有监听
    this.clearWatchers()

    // 销毁所有 Host 进程
    await this.hostManager.destroyAll()

    // 清理内存
    this.plugins.clear()
    this.runners.clear()
    this.initializedPlugins.clear()
  }

  // ================= 文件监听相关 =================

  private watchers: Map<string, import('fs').FSWatcher> = new Map()
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()

  private setupPluginWatcher(plugin: Plugin) {
    // 防止重复监听
    if (this.watchers.has(plugin.id)) return

    try {
      const mainFile = join(plugin.path, plugin.manifest.main)
      const watchDir = require('path').dirname(mainFile)
      const filename = require('path').basename(mainFile)

      if (!existsSync(watchDir)) return

      // console.log(`[PluginManager] Watching ${plugin.id} -> ${watchDir} for ${filename}`)

      // 监听目录以支持原子写入（esbuild 构建通常是先写临时文件再 rename）
      const watcher = require('fs').watch(watchDir, (_eventType: string, triggerFilename: string | null) => {
        // triggerFilename 在某些系统上可能为空，但在 macOS/Windows 上通常有效
        // 我们只关心目标文件的变动
        if (triggerFilename && triggerFilename === filename) {
          this.triggerHotReload(plugin.id)
        }
      })

      this.watchers.set(plugin.id, watcher)
    } catch (err) {
      console.warn(`[PluginManager] Failed to watch plugin ${plugin.id}:`, err)
    }
  }

  private stopPluginWatcher(pluginId: string) {
    const watcher = this.watchers.get(pluginId)
    if (watcher) {
      watcher.close()
      this.watchers.delete(pluginId)
    }
    const timer = this.debounceTimers.get(pluginId)
    if (timer) {
      clearTimeout(timer)
      this.debounceTimers.delete(pluginId)
    }
  }

  private clearWatchers() {
    for (const [id] of this.watchers) {
      this.stopPluginWatcher(id)
    }
  }

  private triggerHotReload(pluginId: string) {
    // 防抖
    if (this.debounceTimers.has(pluginId)) {
      clearTimeout(this.debounceTimers.get(pluginId)!)
    }

    const timer = setTimeout(() => {
      this.reloadBackend(pluginId)
      this.debounceTimers.delete(pluginId)
    }, 300)

    this.debounceTimers.set(pluginId, timer)
  }

  private async reloadBackend(pluginId: string) {
    console.log(`[PluginManager] Hot reloading plugin: ${pluginId}`)
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return

    // 1. 如果有运行中的 Host，销毁它（强制下次运行重新加载代码）
    if (this.hostManager.isHostReady(pluginId)) {
      await this.hostManager.destroyHost(pluginId)
    }

    // 2. 如果插件已初始化（触发过 onLoad），重新触发 onLoad
    if (this.initializedPlugins.has(pluginId)) {
      // 重新标记为未初始化，以便 run() 或其他方法再次触发初始化
      this.initializedPlugins.delete(pluginId)

      // 注意：这里是否立即调用 onLoad 取决于需求。
      // 如果插件是后台运行的（如 onLoad 启动了某些服务），应该立即重启。
      // 但由于 lazy load 策略，我们可以让它在下次用户交互时加载，
      // 或者如果它是常驻的，就立即加载。
      // 为了更好的开发体验，这里尝试主动重新初始化
      await this.initializePlugin(pluginId)
    }

    // 3. 通知 UI 或其他组件（可选）
    // TODO: 可以发送事件给前端提示插件已更新
  }

  private getCombinedFeatures(plugin: Plugin): PluginFeature[] {
    const dynamicFeatures = pluginFeatureStore.getPluginFeatures(plugin.id)
    const dynamicCodes = new Set(dynamicFeatures.map(feature => feature.code))
    const staticFeatures = plugin.manifest.features.filter(feature => !dynamicCodes.has(feature.code))
    return [...staticFeatures, ...dynamicFeatures]
  }
}
