import { app, Notification } from 'electron'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { getInternalPluginDirs, isSystemPlugin } from './internal-plugins'
import { SystemCommandExecutor } from './system-command-executor'
import { collectDevPluginWatchTargets } from './dev-reload-utils'
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
import { getCachedActiveWindow, getActiveWindow } from '../services/active-window'
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
import type { ClipboardHistoryManager } from '../services/clipboard-history'
import log from 'electron-log'

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

  if (cmd.type === 'window') {
    const parts: string[] = []
    if (cmd.app?.trim()) {
      parts.push(`应用：${cmd.app.trim()}`)
    }
    if (cmd.title?.trim()) {
      parts.push(`标题：${cmd.title.trim()}`)
    }
    if (cmd.bundleId?.trim()) {
      parts.push(`Bundle ID：${cmd.bundleId.trim()}`)
    }
    return parts.length > 0 ? parts.join('；') : '窗口匹配'
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
  private initializedPlugins: Set<string> = new Set()  // 生命周期已初始化（用于 onDisable/onUnload 判断）
  /**
   * 跟踪「当前 Worker 进程」是否已执行过 onLoad。
   * 独立于 initializedPlugins，因为 Worker 进程可能因空闲超时/崩溃被销毁，
   * 进程重建后内存清空，pluginToolHandlers 等 Worker 内注册的状态也会丢失，
   * 需要重新触发 onLoad，但不能影响 initializedPlugins 的生命周期语义。
   */
  private workerOnloadedPlugins: Set<string> = new Set()
  private searchWorker: PluginSearchWorker
  private commandShortcutManager: PluginCommandShortcutManager
  private commandDisabledManager: PluginCommandDisabledManager
  private backgroundManager: BackgroundPluginManager
  private taskScheduler: TaskScheduler
  private systemPluginWindowManager: SystemPluginWindowManager | null = null
  private initPromise: Promise<void> | null = null
  private isReloading: boolean = false
  private skipNextWindowClosedHandling: Set<string> = new Set()
  private pluginToolsListener?: (event: 'refresh' | 'remove', pluginId: string, pluginName: string, tools: import('../../shared/types/plugin').PluginToolSchema[]) => void
  private systemCommandExecutor: SystemCommandExecutor
  private systemPageOpenHandler?: (page: string) => void

  // 搜索预热
  private prewarmState: {
    pluginId: string
    promise: Promise<boolean>
    ttlTimer: NodeJS.Timeout
  } | null = null

  constructor() {
    this.stateManager = new PluginStateManager()
    this.hostManager = new PluginHostManager()
    this.searchWorker = new PluginSearchWorker()
    this.commandDisabledManager = new PluginCommandDisabledManager()
    this.systemCommandExecutor = new SystemCommandExecutor()
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

    // P2a 修复: 动态特性变更时自动同步搜索 Worker
    pluginFeatureStore.onChange(() => {
      void this.syncSearchWorker().catch(() => {})
    })

    // 修复：Worker 进程退出后（空闲销毁/崩溃）清除 Worker 级 onLoad 标记，
    // 使下次 AI 工具调用时能重新触发 onLoad，重建 Worker 内的 tool handler 等状态。
    //
    // 注意：仅清除 workerOnloadedPlugins，不动 initializedPlugins（生命周期标记），
    // 保证 disable()/uninstall() 仍能正常调用 onDisable/onUnload 清理主进程资源。
    //
    // P2 竞态防护：用 isHostReady 检查，若新 Host 已就绪（reloadBackend 场景），
    // 说明此 exit 事件属于旧进程，跳过清除，不影响新 Host 的初始化状态。
    this.hostManager.on('host:exit', (pluginId: string) => {
      if (this.hostManager.isHostReady(pluginId)) {
        // 新 Host 已经就绪，这是旧进程的 stale exit 事件，忽略
        return
      }
      this.workerOnloadedPlugins.delete(pluginId)
    })
  }

  /**
   * 设置剪贴板历史管理器
   */
  setClipboardHistoryManager(manager: ClipboardHistoryManager): void {
    this.hostManager.setClipboardHistoryManager(manager)
  }

  getTaskScheduler(): TaskScheduler {
    return this.taskScheduler
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

  /**
   * 设置系统页面打开回调（由 index.ts 注入，用于系统插件的「打开设置/插件商店」等命令）
   */
  setSystemPageOpenHandler(handler: (page: string) => void) {
    this.systemPageOpenHandler = handler
  }

  // 设置 plugin tools 变更监听器（用于同步 pluginToolRegistry）
  setPluginToolsListener(listener: (event: 'refresh' | 'remove', pluginId: string, pluginName: string, tools: import('../../shared/types/plugin').PluginToolSchema[]) => void): void {
    this.pluginToolsListener = listener
  }

  private notifyPluginToolsChanged(plugin: Plugin, event: 'refresh' | 'remove'): void {
    if (!this.pluginToolsListener) return
    const tools = event === 'refresh' && plugin.enabled
      ? (plugin.manifest.tools || [])
      : []
    this.pluginToolsListener(event, plugin.id, plugin.manifest.name, tools)
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

    const { getAppSettings } = await import('../services/app-settings-runtime')
    const settings = getAppSettings()
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

    // 第一步：加载内置插件（系统插件等）
    // 内置插件始终启用，不受用户状态管理控制
    const internalDirs = getInternalPluginDirs()
    for (const internalDir of internalDirs) {
      const loader = new PluginLoader(internalDir)
      // 内置插件目录结构较特殊：直接就是一个插件（非目录的目录扫描）
      const plugin = loader.loadPlugin(internalDir)
      if (plugin && !this.plugins.has(plugin.id)) {
        plugin.enabled = true  // 内置插件始终启用
        this.plugins.set(plugin.id, plugin)
        log.info(`[PluginManager] 加载内置插件: ${plugin.manifest.displayName} (${plugin.id})`)
      }
    }

    for (const dir of dirs) {
      const loader = new PluginLoader(dir)
      const plugins = loader.loadAll()
      for (const plugin of plugins) {
        // 检测 ID 冲突
        if (this.plugins.has(plugin.id)) {
          const existing = this.plugins.get(plugin.id)!
          log.warn(
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

        // 注册 plugin tools（如果有声明）
        if (plugin.enabled && plugin.manifest.tools && plugin.manifest.tools.length > 0) {
          this.notifyPluginToolsChanged(plugin, 'refresh')
        }

        // 如果是开发模式插件，启动文件监听
        if (plugin.isDev && plugin.enabled && shouldWatchDevPlugins) {
          this.setupPluginWatcher(plugin)
        }

        // 注意：不在这里调用 onLoad 钩子
        // UtilityProcess 采用懒加载，只有在插件首次运行时才创建
      }
    }

    log.info(`Loaded ${this.plugins.size} plugins from: ${dirs.join(', ')}`)

    // 启动任务调度器
    await this.taskScheduler.start()

    // 恢复持久化的后台插件
    await this.backgroundManager.restorePersistent(this.getAll())

    // 恢复并刷新指令快捷键绑定
    this.commandShortcutManager.initialize()

    // 预热搜索 worker 并同步插件数据（不阻塞启动流程）
    void this.syncSearchWorker().catch((error) => {
      log.warn('[PluginManager] Search worker sync failed', error)
    })
  }

  // 方案A: 构建并同步插件数据到搜索 Worker
  private async syncSearchWorker(): Promise<void> {
    await this.searchWorker.warmup()
    const pluginData = this.getEnabled().map((plugin) => ({
      pluginId: plugin.id,
      features: this.getCombinedFeatures(plugin).map((feature) => ({
        code: feature.code,
        cmds: feature.cmds
      }))
    }))
    await this.searchWorker.syncPlugins(pluginData)
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

  // 根据 ID 或 manifest.name 获取插件
  get(name: string): Plugin | undefined {
    return this.resolve(name)
  }

  // 统一查找：先按 id 精确匹配，再按 manifest.name 回退
  private resolve(nameOrId: string): Plugin | undefined {
    return this.plugins.get(nameOrId)
      || Array.from(this.plugins.values()).find(p => p.manifest.name === nameOrId)
  }

  // 获取启用的插件
  getEnabled(): Plugin[] {
    return this.getAll().filter(p => p.enabled)
  }

  // 获取插件所有功能入口（包含动态指令）
  getFeatures(name: string): PluginFeature[] {
    const plugin = this.resolve(name)
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

    // P2a 修复: 指令禁用状态变更后同步搜索 Worker
    void this.syncSearchWorker().catch(() => {})

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

  // 搜索偏好：委托 stateManager
  getSearchPreferences() {
    return this.stateManager.getSearchPreferences()
  }

  pinFeature(pluginId: string, featureCode: string) {
    this.stateManager.pinFeature(pluginId, featureCode)
  }

  unpinFeature(pluginId: string, featureCode: string) {
    this.stateManager.unpinFeature(pluginId, featureCode)
  }

  hideFeature(pluginId: string, featureCode: string) {
    this.stateManager.hideFeature(pluginId, featureCode)
  }

  unhideFeature(pluginId: string, featureCode: string) {
    this.stateManager.unhideFeature(pluginId, featureCode)
  }

  removeRecentUsage(pluginId: string, featureCode: string) {
    this.stateManager.removeRecentUsage(pluginId, featureCode)
  }

  // 搜索插件（返回匹配的功能入口，只搜索启用的插件）
  async search(input: string | InputPayload): Promise<SearchResult[]> {
    const enabledPlugins = this.getEnabled()

    const normalizedInput = normalizeInputPayload(input)
    const text = normalizedInput.text
    const attachments = normalizedInput.attachments
    const hasText = text.trim().length > 0
    const hasAttachments = attachments.length > 0

    // 注入系统前台窗口上下文（用于 CmdWindow 匹配）
    // 策略：缓存有值时同步读取（零开销），缓存为空时回退异步调用（确保首次搜索窗口匹配正确）
    // 缓存在主窗口 show 事件中异步刷新
    if (!normalizedInput.activeWindow) {
      const cached = getCachedActiveWindow()
      if (cached) {
        normalizedInput.activeWindow = cached
      } else {
        // 缓存冷启动（首次搜索或应用刚启动），回退到异步调用
        const activeWindow = await getActiveWindow()
        if (activeWindow) {
          normalizedInput.activeWindow = activeWindow
        }
      }
    }

    if (!hasText && !hasAttachments) {
      // 有 activeWindow 时，先找 window 匹配的插件置顶
      if (normalizedInput.activeWindow) {
        const windowMatched: SearchResult[] = []
        const rest: SearchResult[] = []
        for (const plugin of enabledPlugins) {
          let matched = false
          for (const feature of this.getCombinedFeatures(plugin)) {
            const match = findBestMatch(feature, normalizedInput)
            if (match && match.matchType === 'window') {
              windowMatched.push({ plugin, feature, matchType: 'window' })
              matched = true
              break
            }
          }
          if (!matched && plugin.manifest.features[0]) {
            rest.push({ plugin, feature: plugin.manifest.features[0], matchType: 'keyword' })
          }
        }
        return [...windowMatched, ...rest]
      }

      return enabledPlugins.map(p => ({
        plugin: p,
        feature: p.manifest.features[0],
        matchType: 'keyword' as const
      }))
    }

    try {
      const matches = await this.searchWorker.search(normalizedInput)
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
      // P2: 被更新的搜索请求取消时，不回退到主进程搜索，直接返回空
      if (error instanceof Error && error.message === 'Search request superseded') {
        return []
      }
      log.warn('[PluginManager] Search worker failed, falling back to main process search', error)
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
    input?: string | InputPayload,
    launchStart?: number
  ): Promise<{ success: boolean; hasUI?: boolean; error?: string }> {
    const plugin = this.resolve(name)
    if (!plugin) {
      return { success: false, error: 'Plugin not found' }
    }
    if (!plugin.enabled) {
      return { success: false, error: 'Plugin is disabled' }
    }

    // 系统插件拦截：直接调用内建处理函数，不走 Host/Worker 流程
    if (isSystemPlugin(plugin.id)) {
      const normalizedInput = normalizeInputPayload(input)
      const result = await this.systemCommandExecutor.execute(featureCode, normalizedInput, {
        hideMainWindow: () => this.windowManager?.hideMainWindowForCapture(),
        openSystemPage: (page: string) => this.systemPageOpenHandler?.(page)
      })
      if (result.success) {
        this.stateManager.recordRecentUsage(plugin.id, featureCode)
      }
      return result
    }

    const normalizedInput = normalizeInputPayload(input)
    let feature = this.getCombinedFeatures(plugin).find(item => item.code === featureCode)
    let matched = feature ? findBestMatch(feature, normalizedInput) : null
    let filteredAttachments = filterAttachmentsByCmd(normalizedInput.attachments, matched?.cmd)
    let resolvedInput: InputPayload = {
      text: normalizedInput.text,
      attachments: filteredAttachments
    }
    let useUI = Boolean(plugin.manifest.ui) && feature?.mode !== 'silent'
    let useDetached = feature?.mode === 'detached' ||
                      (feature?.mode !== 'ui' && plugin.manifest.pluginSetting?.defaultDetached === true)
    let route = feature?.route
    let shouldHideMain = feature?.mainHide === true
    const isAttachedUI = useUI && !useDetached

    // 懒加载：附着模式延迟到 UI 分支并行执行，其余路径串行等待
    const loadPromise = this.ensurePluginLoaded(plugin, name, launchStart)
    let onLoadJustCalled = false
    if (!isAttachedUI) {
      onLoadJustCalled = await loadPromise
      // onLoad 可能通过 api.features.setFeature() 修改了动态特性，重新解析
      if (onLoadJustCalled) {
        feature = this.getCombinedFeatures(plugin).find(item => item.code === featureCode)
        matched = feature ? findBestMatch(feature, normalizedInput) : null
        filteredAttachments = filterAttachmentsByCmd(normalizedInput.attachments, matched?.cmd)
        resolvedInput = { text: normalizedInput.text, attachments: filteredAttachments }
        useUI = Boolean(plugin.manifest.ui) && feature?.mode !== 'silent'
        useDetached = feature?.mode === 'detached' ||
                      (feature?.mode !== 'ui' && plugin.manifest.pluginSetting?.defaultDetached === true)
        route = feature?.route
        shouldHideMain = feature?.mainHide === true
      }
    }

    // 如果 mainHide 为 true，隐藏主窗口
    if (shouldHideMain && this.windowManager) {
      this.windowManager.hidePanelWindow()
    }

    // preCapture：在启动插件窗口前先执行截图
    // 必须先隐藏主搜索框，否则截图中会包含搜索框
    if (feature?.preCapture) {
      // 隐藏主窗口和面板（无论 mainHide 设置如何）
      if (this.windowManager) {
        this.windowManager.hideMainWindowForCapture()
        // 等待窗口从屏幕上完全消失（macOS/Windows 窗口隐藏有动画延迟）
        await new Promise(resolve => setTimeout(resolve, process.platform === 'darwin' ? 200 : 150))
      }

      try {
        let capturedDataUrl: string | null = null

        if (feature.preCapture === 'region') {
          const { startRegionCapture } = await import('./region-capture')
          capturedDataUrl = await startRegionCapture()
        } else if (feature.preCapture === 'fullscreen') {
          const { pluginScreen } = await import('./screen')
          const primaryDisplay = pluginScreen.getPrimaryDisplay()
          const sources = await pluginScreen.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
          const match = sources.find(s => s.displayId && String(primaryDisplay.id) === String(s.displayId))
          const buffer = await pluginScreen.captureScreen({ sourceId: match?.id, format: 'png' })
          const base64 = buffer.toString('base64')
          capturedDataUrl = `data:image/png;base64,${base64}`
        }

        // 用户取消截图 → 不启动插件，恢复主窗口
        if (!capturedDataUrl) {
          if (this.windowManager && !shouldHideMain) {
            this.windowManager.showMainWindowAfterCapture()
          }
          return { success: false, error: 'Capture cancelled' }
        }

        // 将截图数据注入 attachments
        resolvedInput.attachments = [{
          id: `pre-capture-${Date.now()}`,
          name: feature.preCapture === 'region' ? 'region-shot.png' : 'fullscreen-shot.png',
          size: capturedDataUrl.length,
          kind: 'image' as const,
          dataUrl: capturedDataUrl
        }]
      } catch (err) {
        log.error(`[PluginManager] preCapture failed for ${name}:`, err)
        // preCapture 失败时恢复主窗口，回退到旧流程（让插件自行截图）
        if (this.windowManager && !shouldHideMain) {
          this.windowManager.showMainWindowAfterCapture()
        }
      }
    }

    // 如果插件有 UI 且非静默指令，打开 UI 窗口
    if (useUI) {
      if (!this.windowManager) {
        return { success: false, error: 'Window manager not initialized' }
      }

      if (isAttachedUI) {
        // Optimization 1: onLoad 与窗口创建并行（loadPromise 已在上方启动）
        if (this.systemPluginWindowManager) {
          if (launchStart) log.info(`[LaunchTrace] prepareForAttachedPluginLaunch start | +${Date.now() - launchStart}ms`)
          await this.systemPluginWindowManager.prepareForAttachedPluginLaunch()
          if (launchStart) log.info(`[LaunchTrace] prepareForAttachedPluginLaunch done | +${Date.now() - launchStart}ms`)
        }
        if (launchStart) log.info(`[LaunchTrace] attachPlugin start | +${Date.now() - launchStart}ms`)
        const success = this.windowManager.attachPlugin(plugin, featureCode, resolvedInput, route, launchStart, loadPromise)
        if (launchStart) log.info(`[LaunchTrace] attachPlugin returned success=${success} | +${Date.now() - launchStart}ms`)
        await loadPromise
        if (launchStart) log.info(`[LaunchTrace] parallel pipeline done | +${Date.now() - launchStart}ms`)
        if (success) {
          this.stateManager.recordRecentUsage(plugin.id, featureCode)
        }
        return { success, hasUI: true }
      }

      // Optimization 3: onLoad 内部已调用 initPlugin，跳过冗余 hostInit
      if (this.useUtilityProcess && !onLoadJustCalled) {
        if (launchStart) log.info(`[LaunchTrace] Host init start | +${Date.now() - launchStart}ms`)
        try {
          const hostReady = await this.hostManager.initPlugin(plugin)
          if (!hostReady) {
            log.warn(`[PluginManager] Failed to init host for UI plugin ${name}, continuing anyway`)
          }
        } catch (err) {
          log.error(`[PluginManager] Error initializing host for UI plugin ${name}:`, err)
        }
        if (launchStart) log.info(`[LaunchTrace] Host init done | +${Date.now() - launchStart}ms`)
      }

      const win = this.windowManager.createDetachedWindow(plugin, featureCode, resolvedInput, route)
      const detachedSuccess = Boolean(win)
      if (detachedSuccess) {
        this.stateManager.recordRecentUsage(plugin.id, featureCode)
      }
      return { success: detachedSuccess, hasUI: true }
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
          log.error(`[PluginManager] Failed to call onBackground for ${name}:`, err)
        }

        // 启动后台运行（不再调用 onBackground，因为已经调用过了）
        const bgSuccess = await this.backgroundManager.start(plugin, false)
        if (bgSuccess) {
          log.info(`[PluginManager] Plugin ${name} started in background after execution`)
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
      log.error(`Failed to call ${hookName} for plugin ${plugin.id}:`, err)
    }
  }

  /**
   * 确保插件已加载（触发 onLoad + host init）。
   * 返回 true 表示本次调用触发了 onLoad（callHook 内部已完成 initPlugin）。
   */
  private async ensurePluginLoaded(plugin: Plugin, name: string, launchStart?: number): Promise<boolean> {
    if (!this.initializedPlugins.has(name) || !this.workerOnloadedPlugins.has(name)) {
      if (launchStart) log.info(`[LaunchTrace] onLoad hook start | +${Date.now() - launchStart}ms`)
      await this.callPluginHook(plugin, 'onLoad')
      this.initializedPlugins.add(name)
      this.workerOnloadedPlugins.add(name)
      if (launchStart) log.info(`[LaunchTrace] onLoad hook done | +${Date.now() - launchStart}ms`)
      return true
    }
    return false
  }

  // ==================== 搜索预热 ====================

  private static readonly PREWARM_TTL_MS = 20_000

  /**
   * 预热指定插件的 Host 进程和 onLoad。
   * 搜索结果 Top 1 稳定后由渲染进程触发，使用户回车时 Host 已就绪。
   * 与 run() 中的 ensurePluginLoaded 共享 Promise，不会重复启动。
   */
  async prewarm(pluginId: string): Promise<void> {
    if (this.prewarmState?.pluginId === pluginId) return

    this.cancelPrewarm()

    const plugin = this.resolve(pluginId)
    if (!plugin?.enabled || !plugin.manifest.main) return

    if (this.initializedPlugins.has(pluginId) && this.workerOnloadedPlugins.has(pluginId)) {
      return
    }

    log.info(`[Prewarm] start | plugin=${pluginId}`)
    const prewarmStart = Date.now()

    const promise = this.ensurePluginLoaded(plugin, pluginId).then((loaded) => {
      log.info(`[Prewarm] done | plugin=${pluginId} | loaded=${loaded} | ${Date.now() - prewarmStart}ms`)
      return loaded
    })

    const ttlTimer = setTimeout(() => {
      if (this.prewarmState?.pluginId !== pluginId) return
      this.prewarmState = null

      if (this.initializedPlugins.has(pluginId)
          && this.workerOnloadedPlugins.has(pluginId)
          && !this.hostManager.isHostReady(pluginId)) {
        return
      }

      // 如果插件没有 UI 窗口打开且不在后台运行，销毁 Host
      const hasWindow = this.windowManager?.hasOpenWindowsForPlugin(pluginId)
      const isBackground = this.backgroundManager.isRunning(pluginId)
      if (!hasWindow && !isBackground) {
        log.info(`[Prewarm] TTL expired, destroying host | plugin=${pluginId}`)
        void this.hostManager.destroyHost(pluginId).then(() => {
          this.workerOnloadedPlugins.delete(pluginId)
        })
      }
    }, PluginManager.PREWARM_TTL_MS)
    ttlTimer.unref()

    this.prewarmState = { pluginId, promise, ttlTimer }
  }

  cancelPrewarm(runningPluginId?: string): void {
    if (!this.prewarmState) return
    clearTimeout(this.prewarmState.ttlTimer)
    const prewarmedId = this.prewarmState.pluginId
    this.prewarmState = null

    if (runningPluginId && runningPluginId === prewarmedId) return

    const hasWindow = this.windowManager?.hasOpenWindowsForPlugin(prewarmedId)
    const isBackground = this.backgroundManager.isRunning(prewarmedId)
    if (!hasWindow && !isBackground) {
      log.info(`[Prewarm] cleaning up unused host | plugin=${prewarmedId}`)
      void this.hostManager.destroyHost(prewarmedId).then(() => {
        this.workerOnloadedPlugins.delete(prewarmedId)
      })
    }
  }

  // 启用插件
  async enable(name: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.resolve(name)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }
    if (plugin.enabled) {
      return { success: true }
    }

    const pluginId = plugin.id

    plugin.enabled = true
    this.stateManager.setEnabled(pluginId, true)

    // 如果是开发插件且开启了自动热重载，启用监听
    if (plugin.isDev && await this.shouldAutoReloadDevPlugins()) {
      this.setupPluginWatcher(plugin)
    }

    // 只有已初始化的插件才调用 onEnable 钩子
    if (this.initializedPlugins.has(pluginId)) {
      await this.callPluginHook(plugin, 'onEnable')
    }

    this.commandShortcutManager.refresh()

    // 注册 plugin tools
    this.notifyPluginToolsChanged(plugin, 'refresh')

    // 同步搜索 Worker 插件快照
    void this.syncSearchWorker().catch(() => {})

    return { success: true }
  }

  private async shouldAutoReloadDevPlugins(): Promise<boolean> {
    const { getAppSettings } = await import('../services/app-settings-runtime')
    const developer = getAppSettings().developer
    return developer.enabled && developer.autoReload !== false
  }

  // 禁用插件
  async disable(name: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.resolve(name)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }
    if (!plugin.enabled) {
      return { success: true }
    }

    const pluginId = plugin.id

    // 停止后台运行（如果正在后台运行）
    if (this.backgroundManager.isRunning(pluginId)) {
      await this.backgroundManager.stop(pluginId, 'disabled')
    }

    // 停止文件监听
    this.stopPluginWatcher(pluginId)

    // 关闭插件窗口，并抑制窗口关闭回调触发自动后台化
    this.closePluginWindows(pluginId, true)

    // 只有已初始化的插件才调用钩子
    if (this.initializedPlugins.has(pluginId)) {
      await this.callPluginHook(plugin, 'onDisable')
      // 销毁 Host 进程
      if (this.useUtilityProcess) {
        await this.hostManager.destroyHost(pluginId)
      }
      this.initializedPlugins.delete(pluginId)
      this.workerOnloadedPlugins.delete(pluginId)
    } else if (this.useUtilityProcess && this.hostManager.isHostReady(pluginId) && !this.backgroundManager.isRunning(pluginId)) {
      // 兜底：可能由 redirect/initPlugin 直接拉起 Host，但未进入 initializedPlugins
      await this.hostManager.destroyHost(pluginId)
    }

    plugin.enabled = false
    this.stateManager.setEnabled(pluginId, false)
    this.commandShortcutManager.refresh()

    // 注销 plugin tools
    this.notifyPluginToolsChanged(plugin, 'remove')

    // 同步搜索 Worker 插件快照
    void this.syncSearchWorker().catch(() => {})

    return { success: true }
  }

  // 卸载插件
  async uninstall(name: string): Promise<{ success: boolean; error?: string }> {
    const plugin = this.resolve(name)
    if (!plugin) {
      return { success: false, error: '插件不存在' }
    }

    const pluginId = plugin.id

    try {
      // 关闭插件窗口，并抑制窗口关闭回调触发自动后台化
      this.closePluginWindows(pluginId, true)

      // 停止后台运行（如果正在后台运行）
      if (this.backgroundManager.isRunning(pluginId)) {
        await this.backgroundManager.stop(pluginId, 'uninstalled')
      }

      // 停止监听
      this.stopPluginWatcher(pluginId)

      // 只有已初始化的插件才调用钩子和销毁 Host
      if (this.initializedPlugins.has(pluginId)) {
        await this.callPluginHook(plugin, 'onUnload')
        if (this.useUtilityProcess) {
          await this.hostManager.destroyHost(pluginId)
        }
        this.initializedPlugins.delete(pluginId)
        this.workerOnloadedPlugins.delete(pluginId)
      } else if (this.useUtilityProcess && this.hostManager.isHostReady(pluginId) && !this.backgroundManager.isRunning(pluginId)) {
        // 兜底：可能由 redirect/initPlugin 直接拉起 Host，但未进入 initializedPlugins
        await this.hostManager.destroyHost(pluginId)
      }

      // 删除插件文件
      rmSync(plugin.path, { recursive: true, force: true })

      // 清理内存
      this.plugins.delete(pluginId)
      this.runners.delete(pluginId)
      this.stateManager.removePluginState(pluginId)
      pluginFeatureStore.clearFeatures(pluginId)
      this.commandShortcutManager.removeByPlugin(pluginId)
      this.commandDisabledManager.removeByPlugin(pluginId)

      // 注销 plugin tools
      this.notifyPluginToolsChanged(plugin, 'remove')

      // 同步搜索 Worker 插件快照
      void this.syncSearchWorker().catch(() => {})

      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : '卸载失败'
      return { success: false, error }
    }
  }

  // 获取插件 README
  getReadme(name: string): string | null {
    const plugin = this.resolve(name)
    if (!plugin) return null

    const readmePath = join(plugin.path, 'README.md')
    if (existsSync(readmePath)) {
      try {
        return require('fs').readFileSync(readmePath, 'utf-8')
      } catch (err) {
        log.error(`Failed to read README for plugin ${name}:`, err)
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

  // 主动初始化插件（触发 onLoad）
  // 满足以下任一条件时触发 onLoad：
  // 1. initializedPlugins 中无记录（首次初始化）
  // 2. workerOnloadedPlugins 中无记录（Worker 进程已重建，需重注册 tool handler 等）
  async initializePlugin(name: string): Promise<void> {
    const plugin = this.resolve(name)
    if (!plugin) return
    if (this.initializedPlugins.has(plugin.id) && this.workerOnloadedPlugins.has(plugin.id)) return
    await this.callPluginHook(plugin, 'onLoad')
    this.initializedPlugins.add(plugin.id)
    this.workerOnloadedPlugins.add(plugin.id)
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
      this.workerOnloadedPlugins.clear()
    } finally {
      this.isReloading = false
    }
  }

  // ================= 文件监听相关 =================

  private watchers: Map<string, import('fs').FSWatcher[]> = new Map()
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private metadataDebounceTimers: Map<string, NodeJS.Timeout> = new Map()

  private setupPluginWatcher(plugin: Plugin) {
    // 防止重复监听
    if (this.watchers.has(plugin.id)) return

    try {
      const pathModule = require('path')
      const fsModule = require('fs')
      const targetsByDir = new Map<string, Map<string, Set<'code' | 'metadata'>>>()

      for (const target of collectDevPluginWatchTargets(plugin).filter((item) => item.kind === 'metadata')) {
        const nextWatchDir = pathModule.dirname(target.filePath)
        if (!existsSync(nextWatchDir)) continue

        const filename = pathModule.basename(target.filePath).toLowerCase()
        let dirTargets = targetsByDir.get(nextWatchDir)
        if (!dirTargets) {
          dirTargets = new Map()
          targetsByDir.set(nextWatchDir, dirTargets)
        }

        const kinds = dirTargets.get(filename) || new Set<'code' | 'metadata'>()
        kinds.add(target.kind)
        dirTargets.set(filename, kinds)
      }

      const pluginWatchers: import('fs').FSWatcher[] = []

      for (const [nextWatchDir, dirTargets] of targetsByDir) {
        const watcher = fsModule.watch(nextWatchDir, (_eventType: string, triggerFilename: string | null) => {
          if (!triggerFilename) return

          const normalizedFilename = pathModule.basename(String(triggerFilename)).toLowerCase()
          const kinds = dirTargets.get(normalizedFilename)
          if (!kinds) return

          if (kinds.has('metadata')) {
            this.triggerMetadataReload(plugin.id)
          }
          if (kinds.has('code')) {
            this.triggerHotReload(plugin.id)
          }
        })

        pluginWatchers.push(watcher)
      }

      const mainFile = join(plugin.path, plugin.manifest.main)
      const watchDir = require('path').dirname(mainFile)
      const filename = require('path').basename(mainFile)

      if (!existsSync(watchDir)) return

      // log.info(`[PluginManager] Watching ${plugin.id} -> ${watchDir} for ${filename}`)

      // 监听目录以支持原子写入（esbuild 构建通常是先写临时文件再 rename）
      const watcher = require('fs').watch(watchDir, (_eventType: string, triggerFilename: string | null) => {
        // triggerFilename 在某些系统上可能为空，但在 macOS/Windows 上通常有效
        // 我们只关心目标文件的变动
        if (triggerFilename && triggerFilename === filename) {
          this.triggerHotReload(plugin.id)
        }
      })

      pluginWatchers.push(watcher)
      if (!this.watchers.has(plugin.id)) {
        this.watchers.set(plugin.id, pluginWatchers)
      }
    } catch (err) {
      log.warn(`[PluginManager] Failed to watch plugin ${plugin.id}:`, err)
    }
  }

  private stopPluginWatcher(pluginId: string) {
    const watchers = this.watchers.get(pluginId)
    if (watchers) {
      for (const watcher of watchers) {
        watcher.close()
      }
      this.watchers.delete(pluginId)
    }
    const timer = this.debounceTimers.get(pluginId)
    if (timer) {
      clearTimeout(timer)
      this.debounceTimers.delete(pluginId)
    }
    const metadataTimer = this.metadataDebounceTimers.get(pluginId)
    if (metadataTimer) {
      clearTimeout(metadataTimer)
      this.metadataDebounceTimers.delete(pluginId)
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
      void this.reloadBackend(pluginId)
      this.debounceTimers.delete(pluginId)
    }, 300)

    this.debounceTimers.set(pluginId, timer)
  }

  private triggerMetadataReload(pluginId: string) {
    if (this.metadataDebounceTimers.has(pluginId)) {
      clearTimeout(this.metadataDebounceTimers.get(pluginId)!)
    }

    const timer = setTimeout(() => {
      void this.reloadPluginMetadata(pluginId)
      this.metadataDebounceTimers.delete(pluginId)
    }, 300)

    this.metadataDebounceTimers.set(pluginId, timer)
  }

  private async reloadBackend(pluginId: string) {
    log.info(`[PluginManager] Hot reloading plugin: ${pluginId}`)
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return

    // 1. 如果有运行中的 Host，销毁它（强制下次运行重新加载代码）
    if (this.hostManager.isHostReady(pluginId)) {
      await this.hostManager.destroyHost(pluginId)
    }

    // 2. 如果插件已初始化（触发过 onLoad），重新触发 onLoad
    if (this.initializedPlugins.has(pluginId)) {
      // 清除 Worker 级标记，保留生命周期标记
      // initializePlugin 会因 workerOnloadedPlugins 缺失而重新调用 onLoad
      this.workerOnloadedPlugins.delete(pluginId)

      // 注意：这里是否立即调用 onLoad 取决于需求。
      // 如果插件是后台运行的（如 onLoad 启动了某些服务），应该立即重启。
      // 但由于 lazy load 策略，我们可以让它在下次用户交互时加载，
      // 或者如果它是常驻的，就立即加载。
      // 为了更好的开发体验，这里尝试主动重新初始化
      await this.initializePlugin(pluginId)
    }

    // 3. 发送系统通知提示开发者插件后端代码已更新
    this.notifyDevPluginReloaded(plugin, 'code')
  }

  /**
   * 处理窗口关闭事件
   * 如果插件支持后台运行，则启动后台运行；否则销毁 Host 进程
   */
  // Reload manifest/icon updates without tearing down the whole app.
  private async reloadPluginMetadata(pluginId: string) {
    log.info(`[PluginManager] Reloading plugin metadata: ${pluginId}`)
    const currentPlugin = this.plugins.get(pluginId)
    if (!currentPlugin) return

    const loader = new PluginLoader(currentPlugin.path)
    const nextPlugin = loader.loadPlugin(currentPlugin.path)
    if (!nextPlugin) {
      log.warn(`[PluginManager] Skipped metadata reload for ${pluginId}: plugin manifest is temporarily invalid`)
      return
    }

    if (nextPlugin.id !== currentPlugin.id) {
      log.warn(`[PluginManager] Plugin identity changed during metadata reload (${currentPlugin.id} -> ${nextPlugin.id}), reloading all plugins`)
      await this.init()
      return
    }

    nextPlugin.enabled = currentPlugin.enabled
    nextPlugin.isDev = currentPlugin.isDev

    const wasInitialized = this.initializedPlugins.has(pluginId)
    const wasBackgroundRunning = this.backgroundManager.isRunning(pluginId)

    this.stopPluginWatcher(pluginId)
    this.closePluginWindows(pluginId, true)

    if (wasBackgroundRunning) {
      await this.backgroundManager.stop(pluginId, 'metadata-reload')
    } else if (this.useUtilityProcess && this.hostManager.isHostReady(pluginId)) {
      await this.hostManager.destroyHost(pluginId)
    }

    this.runners.delete(pluginId)
    this.initializedPlugins.delete(pluginId)
    this.workerOnloadedPlugins.delete(pluginId)
    this.plugins.set(pluginId, nextPlugin)

    if (nextPlugin.isDev && nextPlugin.enabled && await this.shouldAutoReloadDevPlugins()) {
      this.setupPluginWatcher(nextPlugin)
    }

    this.commandShortcutManager.refresh()

    // 刷新 plugin tools 注册
    this.notifyPluginToolsChanged(nextPlugin, 'refresh')

    if (!nextPlugin.enabled) {
      return
    }

    if (wasInitialized) {
      await this.initializePlugin(pluginId)
    }

    if (wasBackgroundRunning && nextPlugin.manifest.pluginSetting?.background) {
      await this.backgroundManager.start(nextPlugin, true)
    }

    // P2a 修复: 插件元数据热重载后同步搜索 Worker
    void this.syncSearchWorker().catch(() => {})

    // 发送系统通知提示开发者插件元数据已更新
    this.notifyDevPluginReloaded(nextPlugin, 'metadata')
  }

  /**
   * 发送系统通知提示开发者插件已热重载（仅开发插件）
   * @param plugin 插件实例
   * @param kind 重载类型：'code' 后端代码 | 'metadata' manifest/icon 等元数据
   */
  private notifyDevPluginReloaded(plugin: Plugin, kind: 'code' | 'metadata'): void {
    if (!plugin.isDev) return

    const displayName = plugin.manifest.displayName || plugin.id
    const body = kind === 'code'
      ? `${displayName} 后端代码已热重载`
      : `${displayName} 元数据已更新`

    try {
      const notification = new Notification({
        title: 'Mulby 插件热重载',
        body,
        silent: true
      })
      notification.show()
    } catch {
      // 通知发送失败不影响主流程
    }
  }

  // Decide whether a plugin should keep running after its last window closes.
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
        log.error(`[PluginManager] Failed to call onBackground for ${pluginId}:`, err)
      }

      // 启动后台运行（不再调用 onBackground，因为已经调用过了）
      const success = await this.backgroundManager.start(plugin, false)
      if (success) {
        log.info(`[PluginManager] Plugin ${pluginId} started in background after window closed`)
      } else {
        log.warn(`[PluginManager] Failed to start plugin ${pluginId} in background`)
        // 如果启动后台失败，销毁 Host 进程
        if (this.useUtilityProcess && this.hostManager.isHostReady(pluginId)) {
          await this.hostManager.destroyHost(pluginId)
        }
      }
    } else {
      // 不支持后台运行，销毁 Host 进程
      if (this.useUtilityProcess && this.hostManager.isHostReady(pluginId)) {
        log.info(`[PluginManager] Plugin ${pluginId} does not support background, destroying host`)
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
