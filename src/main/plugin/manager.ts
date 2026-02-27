import { app } from 'electron'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { PluginLoader } from './loader'
import { PluginRunner } from './runner'
import { PluginStateManager } from './state'
import { PluginWindowManager } from './window'
import { PluginHostManager } from './host-manager'
import { PluginCommandShortcutManager } from './command-shortcuts'
import { PluginCommandDisabledManager } from './command-disabled'
import { pluginFeatureStore } from './dynamic-features'
import {
  InputPayload,
  Plugin,
  PluginCmd,
  PluginCommandDisabledToggleInput,
  PluginCommandDisabledToggleResult,
  PluginCommandItem,
  PluginCommandRunInput,
  PluginCommandShortcutBindInput,
  PluginCommandShortcutBindResult,
  PluginCommandShortcutBindingRecord,
  PluginCommandShortcutValidationResult,
  PluginFeature
} from '../../shared/types/plugin'
import { PluginSearchWorker } from './search-worker-manager'
import { SystemPluginWindowManager } from '../services/system-plugin-window-manager'
import {
  filterAttachmentsByCmd,
  findBestMatch,
  getCommandDisplayLabel,
  getCommandId,
  getCommandKind,
  getCommandSignature,
  isCommandBindable,
  normalizeInputPayload
} from '../../shared/search-matcher'
import type { MatchType } from '../../shared/search-matcher'
import { BackgroundPluginManager } from './background-manager'
import { TaskScheduler } from '../scheduler'

// 搜索结果项
interface SearchResult {
  plugin: Plugin
  feature: PluginFeature
  matchType: MatchType
}

interface RecentUsedResult {
  plugin: Plugin
  feature: PluginFeature
  lastUsedAt: number
  useCount: number
}

function formatMatchRuleExplain(cmd: PluginCmd): string | undefined {
  if (cmd.type === 'keyword') {
    return undefined
  }

  if (cmd.type === 'regex') {
    if (cmd.explain?.trim()) {
      return cmd.explain.trim()
    }
    const range: string[] = []
    if (typeof cmd.minLength === 'number') {
      range.push(`最少 ${cmd.minLength} 字符`)
    }
    if (typeof cmd.maxLength === 'number') {
      range.push(`最多 ${cmd.maxLength} 字符`)
    }
    return range.length > 0 ? `正则：${cmd.match}（${range.join('，')}）` : `正则：${cmd.match}`
  }

  if (cmd.type === 'files') {
    const parts: string[] = []
    if (cmd.exts && cmd.exts.length > 0) {
      parts.push(`扩展名：${cmd.exts.join(', ')}`)
    }
    if (cmd.fileType && cmd.fileType !== 'any') {
      parts.push(`类型：${cmd.fileType === 'directory' ? '目录' : '文件'}`)
    }
    if (cmd.match?.trim()) {
      parts.push(`名称正则：${cmd.match.trim()}`)
    }
    if (typeof cmd.minLength === 'number' || typeof cmd.maxLength === 'number') {
      const min = typeof cmd.minLength === 'number' ? cmd.minLength : 0
      const max = typeof cmd.maxLength === 'number' ? cmd.maxLength : '∞'
      parts.push(`数量：${min} ~ ${max}`)
    }
    return parts.length > 0 ? parts.join('；') : '文件匹配'
  }

  if (cmd.type === 'img') {
    if (cmd.exts && cmd.exts.length > 0) {
      return `图像扩展名：${cmd.exts.join(', ')}`
    }
    return '图像匹配'
  }

  const parts: string[] = []
  if (cmd.exclude?.trim()) {
    parts.push(`排除正则：${cmd.exclude.trim()}`)
  }
  if (typeof cmd.minLength === 'number' || typeof cmd.maxLength === 'number') {
    const min = typeof cmd.minLength === 'number' ? cmd.minLength : 0
    const max = typeof cmd.maxLength === 'number' ? cmd.maxLength : '∞'
    parts.push(`文本长度：${min} ~ ${max}`)
  }
  return parts.length > 0 ? parts.join('；') : '文本匹配'
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
  private commandShortcutManager: PluginCommandShortcutManager
  private commandDisabledManager: PluginCommandDisabledManager
  private backgroundManager: BackgroundPluginManager
  private taskScheduler: TaskScheduler
  private systemPluginWindowManager: SystemPluginWindowManager | null = null
  private initPromise: Promise<void> | null = null
  private isReloading: boolean = false
  private skipNextWindowClosedHandling: Set<string> = new Set()

  constructor() {
    this.stateManager = new PluginStateManager()
    this.hostManager = new PluginHostManager()
    this.searchWorker = new PluginSearchWorker()
    this.commandDisabledManager = new PluginCommandDisabledManager()
    this.commandShortcutManager = new PluginCommandShortcutManager({
      listCommands: (pluginId?: string) => this.listCommands(pluginId),
      getPlugin: (pluginId: string) => this.plugins.get(pluginId),
      runPluginCommand: (
        pluginId: string,
        featureCode: string,
        cmdId: string,
        cmdSignature: string,
        input?: string | InputPayload
      ) => this.runCommand({ pluginId, featureCode, cmdId, cmdSignature, input })
    })
    this.backgroundManager = new BackgroundPluginManager(
      this.hostManager,
      this.hostManager.getWatchdog(),
      this.stateManager
    )

    // 初始化任务调度器
    this.taskScheduler = new TaskScheduler()
    this.taskScheduler.setPluginManager(this)
    this.hostManager.setTaskScheduler(this.taskScheduler)
  }

  /**
   * 设置剪贴板历史管理器
   */
  setClipboardHistoryManager(manager: any): void {
    this.hostManager.setClipboardHistoryManager(manager)
  }

  // 设置窗口管理器
  setWindowManager(windowManager: PluginWindowManager) {
    this.windowManager = windowManager
    // 设置窗口关闭回调，处理后台运行
    windowManager.setOnWindowClosedCallback(async (pluginId: string) => {
      await this.handleWindowClosed(pluginId)
    })
  }

  setSystemPluginWindowManager(manager: SystemPluginWindowManager) {
    this.systemPluginWindowManager = manager
  }

  // 初始化：加载所有插件
  async init() {
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this.loadPlugins().finally(() => {
      this.initPromise = null
    })

    return this.initPromise
  }

  private async loadPlugins() {
    await this.resetRuntimeForInit()

    // 动态导入设置管理器，避免循环依赖
    const { appSettingsManager } = await import('../services/app-settings')
    const settings = appSettingsManager.getSettings()
    const developer = settings.developer
    const shouldWatchDevPlugins = developer.enabled && developer.autoReload !== false

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
        if (plugin.isDev && plugin.enabled && shouldWatchDevPlugins) {
          this.setupPluginWatcher(plugin)
        }

        // 注意：不在这里调用 onLoad 钩子
        // UtilityProcess 采用懒加载，只有在插件首次运行时才创建
      }
    }

    console.log(`Loaded ${this.plugins.size} plugins from: ${dirs.join(', ')}`)

    // 启动任务调度器
    await this.taskScheduler.start()

    // 恢复持久化的后台插件
    await this.backgroundManager.restorePersistent(this.getAll())

    // 恢复并刷新指令快捷键绑定
    this.commandShortcutManager.initialize()

    // 预热搜索 worker，降低首次搜索延迟（不阻塞启动流程）
    void this.searchWorker.warmup().catch((error) => {
      console.warn('[PluginManager] Search worker warmup failed', error)
    })
  }

  private async resetRuntimeForInit(): Promise<void> {
    this.isReloading = true
    try {
      // 清理旧监听，避免重复注册和内存泄漏
      this.clearWatchers()

      // 关闭所有插件窗口，防止窗口持有旧运行时
      if (this.windowManager) {
        this.windowManager.closeAll()
      }

      // 停止后台插件，确保后台状态与新插件清单同步
      await this.backgroundManager.stopAll()

      // 销毁所有活跃 Host，后续按需重建
      const activeHosts = this.hostManager.getActiveHosts()
      if (activeHosts.length > 0) {
        await Promise.all(activeHosts.map((pluginId) => this.hostManager.destroyHost(pluginId)))
      }

      // 清理旧内存状态
      this.plugins.clear()
      this.runners.clear()
      this.initializedPlugins.clear()
    } finally {
      this.isReloading = false
    }
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

  // 列出命令（用于“功能指令/匹配指令”管理与快捷键绑定）
  listCommands(pluginId?: string): PluginCommandItem[] {
    const plugins = pluginId ? [this.plugins.get(pluginId)].filter((item): item is Plugin => Boolean(item)) : this.getAll()
    const commands: PluginCommandItem[] = []

    for (const plugin of plugins) {
      const features = this.getCombinedFeatures(plugin, true)
      for (const feature of features) {
        const signatureCounter = new Map<string, number>()
        for (const cmd of feature.cmds) {
          const signature = getCommandSignature(cmd)
          const occurrence = (signatureCounter.get(signature) || 0) + 1
          signatureCounter.set(signature, occurrence)
          const cmdId = getCommandId(cmd, occurrence)
          const disabled = this.commandDisabledManager.isDisabled({
            pluginId: plugin.id,
            featureCode: feature.code,
            cmdId,
            cmdSignature: signature
          })

          commands.push({
            pluginId: plugin.id,
            pluginName: plugin.manifest.name,
            pluginDisplayName: plugin.manifest.displayName,
            featureCode: feature.code,
            featureExplain: feature.explain,
            cmdId,
            cmdType: cmd.type,
            cmdSignature: signature,
            commandKind: getCommandKind(cmd),
            displayLabel: getCommandDisplayLabel(cmd, feature.explain),
            explain: formatMatchRuleExplain(cmd),
            bindable: isCommandBindable(cmd),
            disabled
          })
        }
      }
    }

    commands.sort((a, b) => {
      const pluginCompare = a.pluginDisplayName.localeCompare(b.pluginDisplayName)
      if (pluginCompare !== 0) return pluginCompare
      const featureCompare = a.featureExplain.localeCompare(b.featureExplain)
      if (featureCompare !== 0) return featureCompare
      return a.displayLabel.localeCompare(b.displayLabel)
    })
    return commands
  }

  listCommandShortcuts(pluginId?: string): PluginCommandShortcutBindingRecord[] {
    return this.commandShortcutManager.listBindings(pluginId)
  }

  bindCommandShortcut(input: PluginCommandShortcutBindInput): PluginCommandShortcutBindResult {
    return this.commandShortcutManager.bind(input)
  }

  unbindCommandShortcut(bindingId: string): boolean {
    return this.commandShortcutManager.unbind(bindingId)
  }

  validateCommandShortcut(accelerator: string, bindingId?: string): PluginCommandShortcutValidationResult {
    return this.commandShortcutManager.validateAccelerator(accelerator, bindingId)
  }

  async runCommand(input: PluginCommandRunInput): Promise<{ success: boolean; hasUI?: boolean; error?: string }> {
    const command = this.resolveCommandItem(input.pluginId, input.featureCode, input.cmdId, input.cmdSignature)
    if (!command) {
      return { success: false, error: '指令不存在' }
    }
    if (command.disabled) {
      return { success: false, error: '指令已禁用' }
    }
    return this.run(input.pluginId, input.featureCode, input.input)
  }

  setCommandDisabled(input: PluginCommandDisabledToggleInput): PluginCommandDisabledToggleResult {
    const command = this.resolveCommandItem(input.pluginId, input.featureCode, input.cmdId, input.cmdSignature)
    if (!command) {
      return {
        success: false,
        disabled: input.disabled,
        error: '指令不存在'
      }
    }

    const result = this.commandDisabledManager.setDisabled({
      pluginId: input.pluginId,
      featureCode: input.featureCode,
      cmdId: command.cmdId,
      cmdSignature: command.cmdSignature,
      disabled: input.disabled
    })

    this.commandShortcutManager.refresh()
    return result
  }

  // 获取最近使用的插件功能（按时间倒序）
  getRecentUsed(limit: number = 20): RecentUsedResult[] {
    const recent = this.stateManager.getRecentUsage(limit * 3)
    const results: RecentUsedResult[] = []

    for (const item of recent) {
      const plugin = this.plugins.get(item.pluginId)
      if (!plugin || !plugin.enabled) continue

      const feature = this.getCombinedFeatures(plugin).find((candidate) => candidate.code === item.featureCode)
      if (!feature) continue

      results.push({
        plugin,
        feature,
        lastUsedAt: item.lastUsedAt,
        useCount: item.useCount
      })

      if (results.length >= limit) {
        break
      }
    }

    return results
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
    // 判断是否使用独立窗口：优先使用 feature.mode，其次使用 pluginSetting.defaultDetached
    const useDetached = feature?.mode === 'detached' ||
                        (feature?.mode !== 'ui' && plugin.manifest.pluginSetting?.defaultDetached === true)
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

      // 初始化 Host 进程（确保插件出现在任务管理器中）
      if (this.useUtilityProcess) {
        try {
          const hostReady = await this.hostManager.initPlugin(plugin)
          if (!hostReady) {
            console.warn(`[PluginManager] Failed to init host for UI plugin ${name}, continuing anyway`)
          }
        } catch (err) {
          console.error(`[PluginManager] Error initializing host for UI plugin ${name}:`, err)
        }
      }

      if (useDetached) {
        const win = this.windowManager.createDetachedWindow(plugin, featureCode, resolvedInput, route)
        const success = Boolean(win)
        if (success) {
          this.stateManager.recordRecentUsage(plugin.id, featureCode)
        }
        return { success, hasUI: true }
      }
      if (this.systemPluginWindowManager) {
        await this.systemPluginWindowManager.prepareForAttachedPluginLaunch()
      }
      const success = this.windowManager.attachPlugin(plugin, featureCode, resolvedInput, route)
      if (success) {
        this.stateManager.recordRecentUsage(plugin.id, featureCode)
      }
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

      // 无 UI 插件执行完成后，如果支持后台运行，则启动后台运行
      if (plugin.manifest.pluginSetting?.background && !this.backgroundManager.isRunning(name)) {
        // 调用 onBackground 钩子
        try {
          await this.callPluginHook(plugin, 'onBackground')
        } catch (err) {
          console.error(`[PluginManager] Failed to call onBackground for ${name}:`, err)
        }

        // 启动后台运行（不再调用 onBackground，因为已经调用过了）
        const bgSuccess = await this.backgroundManager.start(plugin, false)
        if (bgSuccess) {
          console.log(`[PluginManager] Plugin ${name} started in background after execution`)
        }
      }

      this.stateManager.recordRecentUsage(plugin.id, featureCode)
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
  private async callPluginHook(plugin: Plugin, hookName: 'onLoad' | 'onUnload' | 'onEnable' | 'onDisable' | 'onBackground' | 'onForeground'): Promise<void> {
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

    // 如果是开发插件且开启了自动热重载，启用监听
    if (plugin.isDev && await this.shouldAutoReloadDevPlugins()) {
      this.setupPluginWatcher(plugin)
    }

    // 只有已初始化的插件才调用 onEnable 钩子
    if (this.initializedPlugins.has(name)) {
      await this.callPluginHook(plugin, 'onEnable')
    }

    this.commandShortcutManager.refresh()

    return { success: true }
  }

  private async shouldAutoReloadDevPlugins(): Promise<boolean> {
    const { appSettingsManager } = await import('../services/app-settings')
    const developer = appSettingsManager.getSettings().developer
    return developer.enabled && developer.autoReload !== false
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

    // 停止后台运行（如果正在后台运行）
    if (this.backgroundManager.isRunning(name)) {
      await this.backgroundManager.stop(name, 'disabled')
    }

    // 停止文件监听
    this.stopPluginWatcher(name)

    // 关闭插件窗口，并抑制窗口关闭回调触发自动后台化
    this.closePluginWindows(name, true)

    // 只有已初始化的插件才调用钩子
    if (this.initializedPlugins.has(name)) {
      await this.callPluginHook(plugin, 'onDisable')
      // 销毁 Host 进程
      if (this.useUtilityProcess) {
        await this.hostManager.destroyHost(name)
      }
      this.initializedPlugins.delete(name)
    } else if (this.useUtilityProcess && this.hostManager.isHostReady(name) && !this.backgroundManager.isRunning(name)) {
      // 兜底：可能由 redirect/initPlugin 直接拉起 Host，但未进入 initializedPlugins
      await this.hostManager.destroyHost(name)
    }

    plugin.enabled = false
    this.stateManager.setEnabled(name, false)
    this.commandShortcutManager.refresh()

    return { success: true }
  }

  // 卸载插件
  async uninstall(name: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.plugins.get(name)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }

    try {
      // 关闭插件窗口，并抑制窗口关闭回调触发自动后台化
      this.closePluginWindows(name, true)

      // 停止后台运行（如果正在后台运行）
      if (this.backgroundManager.isRunning(name)) {
        await this.backgroundManager.stop(name, 'uninstalled')
      }

      // 停止监听
      this.stopPluginWatcher(name)

      // 只有已初始化的插件才调用钩子和销毁 Host
      if (this.initializedPlugins.has(name)) {
        await this.callPluginHook(plugin, 'onUnload')
        if (this.useUtilityProcess) {
          await this.hostManager.destroyHost(name)
        }
        this.initializedPlugins.delete(name)
      } else if (this.useUtilityProcess && this.hostManager.isHostReady(name) && !this.backgroundManager.isRunning(name)) {
        // 兜底：可能由 redirect/initPlugin 直接拉起 Host，但未进入 initializedPlugins
        await this.hostManager.destroyHost(name)
      }

      // 删除插件文件
      rmSync(plugin.path, { recursive: true, force: true })

      // 清理内存
      this.plugins.delete(name)
      this.runners.delete(name)
      this.stateManager.removePluginState(name)
      pluginFeatureStore.clearFeatures(name)
      this.commandShortcutManager.removeByPlugin(name)
      this.commandDisabledManager.removeByPlugin(name)

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

  // 获取 BackgroundPluginManager 实例
  getBackgroundManager(): BackgroundPluginManager {
    return this.backgroundManager
  }

  // 获取当前由窗口驱动的活跃插件（用于任务管理器补全）
  getActiveWindowPlugins(): Array<{ pluginId: string; pluginName: string; displayName: string; startedAt: number }> {
    if (!this.windowManager) return []
    return this.windowManager.getActiveWindowPlugins()
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
    this.isReloading = true
    try {
      // 停止所有监听
      this.clearWatchers()

      // 优雅关闭后台插件
      await this.backgroundManager.shutdown()

      // 关闭任务调度器
      await this.taskScheduler.shutdown()

      // 销毁所有 Host 进程
      await this.hostManager.destroyAll()

      // 停止搜索 Worker
      await this.searchWorker.destroy()
      this.commandShortcutManager.destroy()

      // 清理内存
      this.plugins.clear()
      this.runners.clear()
      this.initializedPlugins.clear()
    } finally {
      this.isReloading = false
    }
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

  /**
   * 处理窗口关闭事件
   * 如果插件支持后台运行，则启动后台运行；否则销毁 Host 进程
   */
  private async handleWindowClosed(pluginId: string): Promise<void> {
    if (this.skipNextWindowClosedHandling.delete(pluginId)) {
      return
    }

    if (this.isReloading) {
      if (this.useUtilityProcess && this.hostManager.isHostReady(pluginId)) {
        await this.hostManager.destroyHost(pluginId)
      }
      return
    }

    const plugin = this.plugins.get(pluginId)
    if (!plugin) return

    // 已禁用插件不应因窗口关闭被拉起后台
    if (!plugin.enabled) {
      if (this.useUtilityProcess && this.hostManager.isHostReady(pluginId) && !this.backgroundManager.isRunning(pluginId)) {
        await this.hostManager.destroyHost(pluginId)
      }
      return
    }

    // 检查插件是否支持后台运行
    const supportsBackground = plugin.manifest.pluginSetting?.background === true

    if (supportsBackground) {
      // 检查是否已经在后台运行
      if (this.backgroundManager.isRunning(pluginId)) {
        return
      }

      // 调用 onBackground 钩子
      try {
        await this.callPluginHook(plugin, 'onBackground')
      } catch (err) {
        console.error(`[PluginManager] Failed to call onBackground for ${pluginId}:`, err)
      }

      // 启动后台运行（不再调用 onBackground，因为已经调用过了）
      const success = await this.backgroundManager.start(plugin, false)
      if (success) {
        console.log(`[PluginManager] Plugin ${pluginId} started in background after window closed`)
      } else {
        console.warn(`[PluginManager] Failed to start plugin ${pluginId} in background`)
        // 如果启动后台失败，销毁 Host 进程
        if (this.useUtilityProcess && this.hostManager.isHostReady(pluginId)) {
          await this.hostManager.destroyHost(pluginId)
        }
      }
    } else {
      // 不支持后台运行，销毁 Host 进程
      if (this.useUtilityProcess && this.hostManager.isHostReady(pluginId)) {
        console.log(`[PluginManager] Plugin ${pluginId} does not support background, destroying host`)
        await this.hostManager.destroyHost(pluginId)
      }
    }
  }

  private getCombinedFeatures(plugin: Plugin, includeDisabledCommands = false): PluginFeature[] {
    const dynamicFeatures = pluginFeatureStore.getPluginFeatures(plugin.id)
    const dynamicCodes = new Set(dynamicFeatures.map(feature => feature.code))
    const staticFeatures = plugin.manifest.features.filter(feature => !dynamicCodes.has(feature.code))
    const combined = [...staticFeatures, ...dynamicFeatures]

    return combined
      .map((feature) => {
        const signatureCounter = new Map<string, number>()
        const cmds = feature.cmds
          .filter((cmd) => {
            const signature = getCommandSignature(cmd)
            const occurrence = (signatureCounter.get(signature) || 0) + 1
            signatureCounter.set(signature, occurrence)
            if (includeDisabledCommands) return true

            const cmdId = getCommandId(cmd, occurrence)
            return !this.commandDisabledManager.isDisabled({
              pluginId: plugin.id,
              featureCode: feature.code,
              cmdId,
              cmdSignature: signature
            })
          })
          .map((cmd) => ({ ...cmd }))

        if (cmds.length === 0) return null
        return { ...feature, cmds }
      })
      .filter((feature): feature is PluginFeature => Boolean(feature))
  }

  private resolveCommandItem(
    pluginId: string,
    featureCode: string,
    cmdId: string,
    cmdSignature: string
  ): PluginCommandItem | undefined {
    const featureCommands = this
      .listCommands(pluginId)
      .filter((item) => item.featureCode === featureCode)

    return featureCommands.find((item) => item.cmdId === cmdId && item.cmdSignature === cmdSignature)
      || featureCommands.find((item) => item.cmdSignature === cmdSignature)
      || featureCommands.find((item) => item.cmdId === cmdId)
  }

  /**
   * 停止运行中的插件（关闭窗口并销毁 Host 进程）
   * @param pluginId 插件 ID
   * @param keepBackground 是否保留后台进程（默认 false）
   */
  async stopPlugin(pluginId: string, keepBackground: boolean = false): Promise<{ success: boolean; error?: string }> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }

    try {
      // 1. 关闭插件窗口（如果有）
      this.closePluginWindows(pluginId, !keepBackground)

      // 2. 如果不保留后台进程，停止后台运行
      if (!keepBackground && this.backgroundManager.isRunning(pluginId)) {
        await this.backgroundManager.stop(pluginId, 'manual')
      }

      // 3. 如果不保留后台进程，销毁 Host 进程
      if (!keepBackground && this.useUtilityProcess && this.hostManager.isHostReady(pluginId)) {
        await this.hostManager.destroyHost(pluginId)
      }

      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : '停止插件失败'
      return { success: false, error }
    }
  }

  /**
   * 仅关闭插件窗口，保留后台进程
   */
  async closePluginWindow(pluginId: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }

    // 如果插件支持后台运行，保留后台进程
    const supportsBackground = plugin.manifest.pluginSetting?.background === true
    return await this.stopPlugin(pluginId, supportsBackground)
  }

  private closePluginWindows(pluginId: string, suppressWindowClosedHandling: boolean): void {
    if (!this.windowManager) return

    const shouldSuppress = suppressWindowClosedHandling && this.windowManager.hasOpenWindowsForPlugin(pluginId)
    if (shouldSuppress) {
      this.skipNextWindowClosedHandling.add(pluginId)
    }

    // 关闭所有该插件的独立窗口
    this.windowManager.closeDetachedWindowsByPlugin(pluginId)

    // 如果当前附着的插件是该插件，关闭附着模式
    const currentPlugin = this.windowManager.getPanelWindow()?.getCurrentPlugin()
    if (currentPlugin?.id === pluginId) {
      this.windowManager.closeAttached()
    }

    // 没有窗口关闭回调触发时，主动清理抑制标记
    if (shouldSuppress && !this.windowManager.hasOpenWindowsForPlugin(pluginId)) {
      this.skipNextWindowClosedHandling.delete(pluginId)
    }
  }
}
