import { app } from 'electron'
import { join, extname } from 'path'
import { existsSync, rmSync } from 'fs'
import { PluginLoader } from './loader'
import { PluginRunner } from './runner'
import { PluginStateManager } from './state'
import { PluginWindowManager } from './window'
import { PluginHostManager } from './host-manager'
import { pluginFeatureStore } from './dynamic-features'
import { InputAttachment, InputPayload, Plugin, PluginFeature } from '../../shared/types/plugin'

// 搜索结果项
interface SearchResult {
  plugin: Plugin
  feature: PluginFeature
  matchType: 'keyword' | 'regex' | 'files' | 'img'
}

interface FeatureMatch {
  matchType: SearchResult['matchType']
  cmd: PluginCmd
  score: number
}

function normalizeInputPayload(input?: string | InputPayload): InputPayload {
  if (!input) {
    return { text: '', attachments: [] }
  }
  if (typeof input === 'string') {
    return { text: input, attachments: [] }
  }
  return {
    text: input.text || '',
    attachments: Array.isArray(input.attachments) ? input.attachments : []
  }
}

function matchPriority(type: SearchResult['matchType']): number {
  switch (type) {
    case 'img':
      return 3
    case 'files':
      return 3
    case 'regex':
      return 2
    case 'keyword':
      return 1
  }
}

function normalizeExt(value: string): string {
  if (!value) return ''
  const trimmed = value.trim().toLowerCase()
  if (trimmed === '*' || trimmed === '.*') return '*'
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

function getAttachmentExt(attachment: InputAttachment): string {
  if (attachment.ext) return normalizeExt(attachment.ext)
  if (attachment.path) return normalizeExt(extname(attachment.path))
  if (attachment.name) return normalizeExt(extname(attachment.name))
  return ''
}

function matchesFiles(exts: string[], attachments: InputAttachment[]): boolean {
  const normalizedExts = exts.map(normalizeExt)
  const hasWildcard = normalizedExts.includes('*')
  if (hasWildcard) return attachments.length > 0

  return attachments.some((attachment) => {
    const ext = getAttachmentExt(attachment)
    if (!ext) return false
    return normalizedExts.includes(ext)
  })
}

function matchesImageExts(exts: string[] | undefined, attachments: InputAttachment[]): boolean {
  const imageAttachments = attachments.filter((attachment) => isImageAttachment(attachment))
  if (!exts || exts.length === 0) return imageAttachments.length > 0
  return matchesFiles(exts, imageAttachments)
}

function filterAttachmentsByCmd(attachments: InputAttachment[], cmd?: PluginCmd): InputAttachment[] {
  if (!cmd) return attachments
  if (cmd.type !== 'files' && cmd.type !== 'img') return attachments
  if (!cmd.exts || cmd.exts.length === 0) return attachments

  const normalizedExts = cmd.exts.map(normalizeExt)
  if (normalizedExts.includes('*')) return attachments

  return attachments.filter((attachment) => {
    const ext = getAttachmentExt(attachment)
    if (!ext) return false
    return normalizedExts.includes(ext)
  })
}

function isImageAttachment(attachment: InputAttachment): boolean {
  if (attachment.kind === 'image') return true
  if (attachment.mime?.toLowerCase().startsWith('image/')) return true
  const ext = getAttachmentExt(attachment)
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.tif', '.heic', '.heif'].includes(ext)
}

function findBestMatch(feature: PluginFeature, input: InputPayload): FeatureMatch | null {
  const text = input.text
  const q = text.toLowerCase()
  const hasText = text.trim().length > 0
  const hasAttachments = input.attachments.length > 0

  let best: FeatureMatch | null = null

  for (const cmd of feature.cmds) {
    let matchType: SearchResult['matchType'] | null = null

    if (cmd.type === 'regex') {
      if (!hasText) continue
      try {
        const regex = new RegExp(cmd.match)
        if (regex.test(text)) {
          matchType = 'regex'
        }
      } catch { }
    }

    if (cmd.type === 'keyword') {
      if (!hasText) continue
      if (cmd.value.toLowerCase().includes(q)) {
        matchType = 'keyword'
      }
    }

    if (cmd.type === 'files') {
      if (!hasAttachments) continue
      if (matchesFiles(cmd.exts, input.attachments)) {
        matchType = 'files'
      }
    }

    if (cmd.type === 'img') {
      if (!hasAttachments) continue
      if (matchesImageExts(cmd.exts, input.attachments)) {
        matchType = 'img'
      }
    }

    if (!matchType) continue

    const score = matchPriority(matchType)
    if (!best || score > best.score) {
      best = { matchType, cmd, score }
    }
  }

  return best
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
  search(input: string | InputPayload): SearchResult[] {
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
