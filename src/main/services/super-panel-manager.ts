/**
 * 超级面板核心控制器
 *
 * 调度超级面板的完整生命周期：
 * 1. 鼠标/键盘/双击修饰键手势监听
 * 2. 应用黑名单过滤（通过 ActiveWindow 缓存）
 * 3. 跨平台原生取词（macOS AX API / Windows UIA / Linux X11 PRIMARY）+ 剪贴板附件采集
 * 4. 匹配引擎查询（复用 search-matcher）
 * 5. 面板窗口管理（委托 SuperPanelWindowManager）
 * 6. 即时翻译与插件执行
 */

import { BrowserWindow, clipboard, screen } from 'electron'
import type { InputHookService, MouseEventData } from './input-hook'
import type { PluginManager } from '../plugin'
import type { AppSettingsManager } from './app-settings'
import type { ThemeManager } from './theme'
import type { SuperPanelSettings } from '../../shared/types/settings'
import type { ClipboardHistoryManager } from './clipboard-history'
import { getCachedActiveWindow } from './active-window'
import { findBestMatch, matchesWindow } from '../../shared/search-matcher'
import type { Plugin, InputPayload, InputAttachment, ActiveWindowInfo } from '../../shared/types/plugin'
import { SuperPanelWindowManager } from './super-panel-window'
import { SuperPanelStore, type SuperPanelPinnedItem, type SuperPanelGroup } from './super-panel-store'
import { aiService } from '../ai'
import { getSelectedTextAsync } from './native-text-selection'
import log from 'electron-log'

// ==================== 类型定义 ====================

/** 超级面板中展示的匹配条目 */
export interface SuperPanelItem {
  /** 唯一标识 */
  id: string
  /** 插件信息 */
  pluginId: string
  pluginName: string
  pluginDisplayName: string
  pluginIcon?: string
  /** 功能入口信息 */
  featureCode: string
  featureExplain: string
  featureIcon?: string
  /** 匹配类型（over / regex / window 等） */
  matchType: string
  /** 匹配分数 */
  score: number
  /** 上下文加权分（当前应用匹配 window cmd 时 > 0） */
  contextBoost: number
}

/** 即时翻译状态 */
export interface SuperPanelTranslation {
  text: string
  loading: boolean
  error?: string
  expanded?: boolean
  expandedHeight?: number
}

/** 面板状态（通过 IPC 推送给渲染进程） */
export interface SuperPanelState {
  /** 捕获到的文本预览 */
  capturedText: string
  /** 匹配结果列表 */
  items: SuperPanelItem[]
  /** 面板是否可见 */
  visible: boolean
  /** 面板模式：'match' 匹配结果 | 'pinned' 固定列表 */
  mode: 'match' | 'pinned'
  /** 固定列表数据（mode='pinned' 时有效，已弃用，使用 pinnedGroups） */
  pinnedItems?: SuperPanelPinnedItem[]
  /** 分组化的固定列表（mode='pinned' 时有效） */
  pinnedGroups?: SuperPanelGroup[]
  /** 即时翻译结果（异步推送） */
  translation?: SuperPanelTranslation
  /** 当前前台应用上下文（用于前端展示上下文标签） */
  activeApp?: { app: string; bundleId?: string }
}

// 钩子注册 ID
const HOOK_ID = 'super-panel'

// ==================== SuperPanelManager ====================

export class SuperPanelManager {
  private windowManager: SuperPanelWindowManager | null = null
  private isActive = false
  private capturedText = ''
  // 追踪当前注册的 double-tap modifier（用于注销）
  private registeredDoubleTapModifier: string | null = null
  // 防抖：防止短时间内重复触发
  private lastTriggerTime = 0
  private readonly TRIGGER_DEBOUNCE_MS = 300
  // 持久化层
  private readonly store = new SuperPanelStore()
  // 当前匹配结果缓存（用于二次搜索过滤）
  private cachedItems: SuperPanelItem[] = []
  // 翻译请求序号（用于丢弃过时结果）
  private translationSeq = 0
  // 当前的翻译状态
  private currentTranslation?: SuperPanelTranslation
  private currentQuery?: string // 当前二次过滤词，用于保留禁用项时的过滤状态

  // 缓存的附件列表（文件/图片），用于传递给插件
  private cachedAttachments: InputAttachment[] = []
  // 缓存触发时的前台应用上下文（面板打开期间复用，避免获取到 Mulby 自己）
  private cachedActiveWindow: ActiveWindowInfo | undefined = undefined

  private readonly getMainWindow: () => BrowserWindow | null

  constructor(
    private readonly inputHookService: InputHookService,
    private readonly pluginManager: PluginManager,
    private readonly settingsManager: AppSettingsManager,
    private readonly themeManager: ThemeManager,
    private readonly clipboardHistoryManager?: ClipboardHistoryManager,
    options?: { getMainWindow?: () => BrowserWindow | null }
  ) {
    this.getMainWindow = options?.getMainWindow ?? (() => null)
  }

  // ==================== 生命周期 ====================

  /** 根据当前设置启用/更新超级面板 */
  enable(): void {
    const settings = this.getSettings()
    if (!settings.enabled) {
      this.disable()
      return
    }

    // 先注销旧绑定
    this.unregisterHooks()

    const { trigger } = settings

    switch (trigger.type) {
      case 'mouse_click':
        if (trigger.mouseButton) {
          this.inputHookService.registerMouse(
            HOOK_ID,
            trigger.mouseButton,
            'click',
            (event) => this.onTrigger(event)
          )
        }
        break

      case 'mouse_longpress':
        if (trigger.mouseButton) {
          this.inputHookService.registerMouse(
            HOOK_ID,
            trigger.mouseButton,
            'longpress',
            (event) => this.onTrigger(event),
            trigger.longPressMs || 500
          )
        }
        break

      case 'keyboard':
        if (trigger.accelerator) {
          this.inputHookService.register(
            HOOK_ID,
            trigger.accelerator,
            () => this.onKeyboardTrigger()
          )
        }
        break

      case 'double_tap': {
        const mod = trigger.modifier || 'Command'
        this.inputHookService.registerDoubleTap(
          mod,
          () => this.onKeyboardTrigger()
        )
        this.registeredDoubleTapModifier = mod
        break
      }
    }

    this.isActive = true
    log.info(`[SuperPanel] 已启用，触发方式: ${trigger.type}`)
    
    // 空闲时预热窗口（延迟 2 秒，确保主窗口优先加载完成）
    setTimeout(() => {
      if (this.isActive) {
        this.ensureWindowManager()
        void this.windowManager!.preWarm()
      }
    }, 2000)
  }

  /** 禁用超级面板 */
  disable(): void {
    this.unregisterHooks()
    // 禁用时仅隐藏面板，不恢复剪贴板（可能没有快照，否则会写空值）
    if (this.windowManager) {
      this.windowManager.hide()
    }
    this.isActive = false
    log.info('[SuperPanel] 已禁用')
  }

  /** 销毁服务，释放全部资源 */
  destroy(): void {
    this.disable()
    if (this.windowManager) {
      this.windowManager.destroy()
      this.windowManager = null
    }
  }

  // ==================== 触发处理 ====================

  /** 鼠标触发入口 */
  private async onTrigger(event: MouseEventData): Promise<void> {
    // 防抖
    const now = Date.now()
    if (now - this.lastTriggerTime < this.TRIGGER_DEBOUNCE_MS) return
    if (!this.isActive) return
    this.lastTriggerTime = now

    // 黑名单检查
    if (this.isBlockedApp()) return

    // 获取鼠标坐标（Linux evdev 可能不提供坐标）
    let x = event.x
    let y = event.y
    if (x === 0 && y === 0 && process.platform === 'linux') {
      const cursor = screen.getCursorScreenPoint()
      x = cursor.x
      y = cursor.y
    }

    await this.triggerWorkflow(x, y)
  }

  /** 键盘/双击修饰键触发入口（无坐标，使用当前鼠标位置） */
  private async onKeyboardTrigger(): Promise<void> {
    const now = Date.now()
    if (now - this.lastTriggerTime < this.TRIGGER_DEBOUNCE_MS) return
    if (!this.isActive) return
    this.lastTriggerTime = now

    if (this.isBlockedApp()) return

    const cursor = screen.getCursorScreenPoint()
    await this.triggerWorkflow(cursor.x, cursor.y)
  }

  /**
   * 核心工作流：原生取词 + 附件采集 → 匹配 → 显示面板
   *
   * 时序：
   * 1. 跨平台原生取词 (macOS AX API / Windows UIA / Linux X11 PRIMARY, 2~20ms)
   * 2. 取词失败时自动触发剪贴板模拟回退 (<50ms)
   * 3. 独立采集剪贴板附件：文件/图片 (同步, <1ms)
   * 4. 获取焦点应用上下文 (<1ms)
   * 5. 匹配结果并显示面板
   * 6. 异步翻译
   */
  private async triggerWorkflow(x: number, y: number): Promise<void> {
    try {
      // 跨平台原生取词
      // 传入 fallback 选项，在原生 API 完全失败时才会触发安全的模拟复制回退
      const selectionResult = await getSelectedTextAsync({
        clipboardHistoryManager: this.clipboardHistoryManager,
        suppressSyntheticInput: (durationMs) => 
          this.inputHookService.suppressDoubleTapForSyntheticInput(durationMs),
        fallbackDelayMs: this.getSettings().clipboardPollDelayMs
      })

      // 选中文本
      const text = selectionResult.text || ''

      // 附件由取词层统一采集：
      // - 原生取词拿到文本 → 无附件（不混入旧剪贴板内容）
      // - 无文本但剪贴板有文件/图片 → 取词层直接读取
      // - 回退路径 → 内部快照比较采集
      this.capturedText = text
      this.cachedAttachments = selectionResult.attachments

      const hasNewContent = this.capturedText.trim().length > 0 || this.cachedAttachments.length > 0

      if (hasNewContent) {
        // ===== 有选中文本或附件 → 匹配模式 =====
        this.currentQuery = undefined
        this.currentTranslation = undefined
        this.translationSeq++
        
        const activeWindowInfo = getCachedActiveWindow()
        this.cachedActiveWindow = activeWindowInfo || undefined

        const items = this.matchContent(this.capturedText, this.getSettings().maxItems)
        this.cachedItems = items

        const activeApp = activeWindowInfo
          ? { app: activeWindowInfo.app, bundleId: activeWindowInfo.bundleId }
          : undefined

        this.showPanel(x, y, {
          capturedText: this.capturedText,
          items,
          visible: true,
          mode: 'match',
          activeApp
        })

        if (this.getSettings().instantTranslation && this.capturedText.length > 0) {
          void this.requestTranslation(this.capturedText)
        }
      } else {
        // ===== 无选中文本及附件 → 固定列表模式 =====
        this.translationSeq++
        const activeWindowInfo = getCachedActiveWindow()
        this.cachedActiveWindow = activeWindowInfo || undefined
        
        const pinnedGroups = this.buildPinnedGroups()
        this.cachedItems = []

        const hasAnyItem = pinnedGroups.some((g) => g.items.length > 0)
        if (!hasAnyItem) {
          return
        }

        const pinnedItems = pinnedGroups.flatMap((g) => g.items)

        this.showPanel(x, y, {
          capturedText: '',
          items: [],
          visible: true,
          mode: 'pinned',
          pinnedItems,
          pinnedGroups
        })
      }
    } catch (err) {
      log.error('[SuperPanel] 触发工作流异常:', err)
    }
  }

  // ==================== 匹配引擎 ====================

  /** 使用 search-matcher 对捕获内容执行插件匹配，叠加使用频率和搜索偏好 */
  private matchContent(text: string, maxItems: number): SuperPanelItem[] {
    // 无文本且无附件时不执行匹配
    if ((!text || text.trim().length === 0) && this.cachedAttachments.length === 0) return []

    // 使用触发时缓存的前台应用上下文，避免面板获焦后 getCachedActiveWindow() 返回 Mulby 自身
    const activeWindow = this.cachedActiveWindow || undefined
    const input: InputPayload = {
      text,
      attachments: this.cachedAttachments,
      activeWindow
    }

    const results: SuperPanelItem[] = []
    const plugins = this.pluginManager.getAll()

    for (const plugin of plugins) {
      if (!plugin.enabled) continue

      // 使用 getFeatures（复用 getCombinedFeatures）自动过滤已禁用的命令
      const features = this.pluginManager.getFeatures(plugin.id)
      for (const feature of features) {

        const match = findBestMatch(feature, input)
        if (!match) continue

        // 上下文加权：检测 feature 是否有 window cmd 匹配当前前台应用
        let contextBoost = 0
        if (activeWindow) {
          for (const cmd of feature.cmds) {
            if (cmd.type === 'window' && matchesWindow(cmd, activeWindow)) {
              contextBoost = 3
              break
            }
          }
        }

        results.push({
          id: `${plugin.id}:${feature.code}`,
          pluginId: plugin.id,
          pluginName: plugin.manifest.name,
          pluginDisplayName: plugin.manifest.displayName || plugin.manifest.name,
          pluginIcon: this.resolvePluginIcon(plugin),
          featureCode: feature.code,
          featureExplain: feature.explain || feature.code,
          featureIcon: undefined,
          matchType: match.matchType,
          score: match.score,
          contextBoost
        })
      }
    }

    // 叠加使用频率权重
    const recentUsage = this.pluginManager.getRecentUsed(50)
    const usageMap = new Map<string, number>()
    for (const item of recentUsage) {
      usageMap.set(`${item.plugin.id}:${item.feature.code}`, item.useCount)
    }

    // 搜索偏好置顶
    const preference = this.store.getPreference(text)

    // 综合排序：偏好置顶 > 分数 + 使用频率 + 上下文加权
    return results
      .sort((a, b) => {
        // 偏好匹配的条目置顶
        if (preference) {
          const aIsPreferred = a.pluginId === preference.pluginId && a.featureCode === preference.featureCode
          const bIsPreferred = b.pluginId === preference.pluginId && b.featureCode === preference.featureCode
          if (aIsPreferred && !bIsPreferred) return -1
          if (!aIsPreferred && bIsPreferred) return 1
        }
        // 使用频率加权：每次使用增加 0.1 分，上限 2 分
        const aBoost = Math.min((usageMap.get(a.id) || 0) * 0.1, 2)
        const bBoost = Math.min((usageMap.get(b.id) || 0) * 0.1, 2)
        return (b.score + bBoost + b.contextBoost) - (a.score + aBoost + a.contextBoost)
      })
      .slice(0, maxItems)
  }

  /** 解析插件图标为 data-url 字符串 */
  private resolvePluginIcon(plugin: Plugin): string | undefined {
    if (!plugin.resolvedIcon) return undefined
    if (plugin.resolvedIcon.type === 'data-url' || plugin.resolvedIcon.type === 'url') {
      return plugin.resolvedIcon.value
    }
    if (plugin.resolvedIcon.type === 'svg') {
      return `data:image/svg+xml;base64,${Buffer.from(plugin.resolvedIcon.value).toString('base64')}`
    }
    if (plugin.resolvedIcon.type === 'emoji') {
      return plugin.resolvedIcon.value
    }
    return undefined
  }

  // ==================== 黑名单 ====================

  /** 检查当前前台应用是否在黑名单中 */
  private isBlockedApp(): boolean {
    const activeWindow = getCachedActiveWindow()
    if (!activeWindow) return false

    const settings = this.getSettings()
    const blockedApps = settings.blockedApps

    for (const blocked of blockedApps) {
      const lower = blocked.toLowerCase()
      // macOS: 匹配 bundleId 或 app 名称
      if (activeWindow.bundleId && activeWindow.bundleId.toLowerCase() === lower) return true
      if (activeWindow.app && activeWindow.app.toLowerCase() === lower) return true
    }

    return false
  }

  // ==================== 面板窗口 ====================

  /** 显示面板 */
  private showPanel(x: number, y: number, state: SuperPanelState): void {
    const manager = this.ensureWindowManager()
    manager.showAt(x, y, state)
  }

  /** 隐藏面板 */
  hidePanel(): void {
    if (this.windowManager) {
      this.windowManager.hide()
    }
  }

  /** 确保窗口管理器已初始化 */
  private ensureWindowManager(): SuperPanelWindowManager {
    if (!this.windowManager) {
      this.windowManager = new SuperPanelWindowManager({
        themeManager: this.themeManager,
        onAction: (action, payload) => this.handleAction(action, payload),
        onHide: () => { /* 面板隐藏时的清理逻辑（按需） */ }
      })
    }
    return this.windowManager
  }

  // ==================== IPC 动作处理 ====================

  /** 处理渲染进程发来的面板动作 */
  async handleAction(
    action: string,
    payload?: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      switch (action) {
        case 'execute': {
          const pluginId = String(payload?.pluginId || '')
          const featureCode = String(payload?.featureCode || '')
          if (!pluginId || !featureCode) {
            return { success: false, error: '缺少 pluginId 或 featureCode' }
          }

          // 记录搜索偏好（有选中文本时）
          if (this.capturedText.trim().length > 0) {
            this.store.recordPreference(this.capturedText, pluginId, featureCode)
          }

          this.hidePanel()
          // 将捕获的文本和附件一起传入插件执行
          const execInput: InputPayload = {
            text: this.capturedText,
            attachments: this.cachedAttachments
          }
          const result = await this.pluginManager.run(pluginId, featureCode, execInput)
          return { success: result.success, error: result.error }
        }

        case 'close':
          this.hidePanel()
          return { success: true }

        case 'search': {
          // 二次搜索：在缓存的匹配结果中过滤
          const query = String(payload?.query || '').trim()
          this.currentQuery = query
          const filtered = this.filterItems(query)
          this.pushState({
            capturedText: this.capturedText,
            items: filtered,
            visible: true,
            mode: 'match'
          })
          return { success: true }
        }

        case 'pin': {
          const pluginId = String(payload?.pluginId || '')
          const featureCode = String(payload?.featureCode || '')
          const displayName = String(payload?.displayName || featureCode)
          const pluginIcon = payload?.pluginIcon ? String(payload.pluginIcon) : undefined
          if (!pluginId || !featureCode) {
            return { success: false, error: '缺少 pluginId 或 featureCode' }
          }
          this.store.pin({ pluginId, featureCode, displayName, pluginIcon })
          return { success: true }
        }

        case 'unpin': {
          const pluginId = String(payload?.pluginId || '')
          const featureCode = String(payload?.featureCode || '')
          if (!pluginId || !featureCode) {
            return { success: false, error: '缺少 pluginId 或 featureCode' }
          }
          this.store.unpin(pluginId, featureCode)
          // 刷新固定列表（使用分组接口）
          const pinnedGroups = this.buildPinnedGroups()
          const pinnedItems = pinnedGroups.flatMap((g) => g.items)
          this.pushState({
            capturedText: '',
            items: [],
            visible: true,
            mode: 'pinned',
            pinnedItems,
            pinnedGroups
          })
          return { success: true }
        }

        // ==================== 分组管理 ====================

        case 'createGroup': {
          const name = String(payload?.name || '').trim()
          const boundApp = payload?.boundApp ? String(payload.boundApp) : undefined
          if (!name) return { success: false, error: '分组名称不能为空' }
          const groupId = this.store.createGroup(name, boundApp)
          return { success: true, data: { groupId } } as any
        }

        case 'deleteGroup': {
          const groupId = String(payload?.groupId || '')
          if (!groupId) return { success: false, error: '缺少分组 ID' }
          const deleted = this.store.deleteGroup(groupId)
          return { success: deleted, error: deleted ? undefined : '默认分组不可删除' }
        }

        case 'renameGroup': {
          const groupId = String(payload?.groupId || '')
          const name = String(payload?.name || '').trim()
          if (!groupId || !name) return { success: false, error: '缺少参数' }
          const renamed = this.store.renameGroup(groupId, name)
          return { success: renamed, error: renamed ? undefined : '分组不存在' }
        }

        case 'updateGroupBoundApp': {
          const groupId = String(payload?.groupId || '')
          const boundApp = payload?.boundApp ? String(payload.boundApp) : undefined
          if (!groupId) return { success: false, error: '缺少分组 ID' }
          const updated = this.store.updateGroupBoundApp(groupId, boundApp)
          return { success: updated, error: updated ? undefined : '分组不存在' }
        }

        case 'reorderItem': {
          const groupId = String(payload?.groupId || '')
          const fromIndex = Number(payload?.fromIndex ?? -1)
          const toIndex = Number(payload?.toIndex ?? -1)
          if (!groupId) return { success: false, error: '缺少分组 ID' }
          const reordered = this.store.reorderItem(groupId, fromIndex, toIndex)
          return { success: reordered, error: reordered ? undefined : '分组不存在或索引无效' }
        }

        case 'reorderGroup': {
          const fromIndex = Number(payload?.fromIndex ?? -1)
          const toIndex = Number(payload?.toIndex ?? -1)
          const reordered = this.store.reorderGroup(fromIndex, toIndex)
          return { success: reordered, error: reordered ? undefined : '分组索引无效' }
        }

        case 'moveItemToGroup': {
          const pluginId = String(payload?.pluginId || '')
          const featureCode = String(payload?.featureCode || '')
          const targetGroupId = String(payload?.targetGroupId || '')
          if (!pluginId || !featureCode || !targetGroupId) {
            return { success: false, error: '缺少参数' }
          }
          const moved = this.store.moveItemToGroup(pluginId, featureCode, targetGroupId)
          if (!moved) {
            return { success: false, error: '移动失败，目标分组不存在或项未找到' }
          }
          // 重建并推送更新后的固定分组状态
          const pinnedGroups = this.buildPinnedGroups()
          const pinnedItems = pinnedGroups.flatMap((g) => g.items)
          this.pushState({
            capturedText: '',
            items: [],
            visible: true,
            mode: 'pinned',
            pinnedItems,
            pinnedGroups
          })
          return { success: true }
        }

        case 'getGroups': {
          // 前端获取全部分组列表（用于「移动到分组」子菜单）
          const groups = this.store.getAllGroups().map((g) => ({
            id: g.id, name: g.name, boundApp: g.boundApp, itemCount: g.items.length
          }))
          return { success: true, data: { groups } } as any
        }

        case 'translationToggle': {
           if (this.currentTranslation) {
              this.currentTranslation.expanded = Boolean(payload?.expanded)
              if (payload?.height && typeof payload.height === 'number') {
                this.currentTranslation.expandedHeight = payload.height
              }
              this.pushTranslation(this.currentTranslation)
           }
           return { success: true }
        }

        case 'copyTranslation': {
          // 通过主进程剪贴板 API 完成复制（避免渲染进程 navigator.clipboard 权限问题）
          const textToCopy = String(payload?.text || '').trim()
          if (!textToCopy) {
            return { success: false, error: '无翻译内容可复制' }
          }
          clipboard.writeText(textToCopy)
          return { success: true }
        }

        // ==================== Action Panel 动作 ====================

        case 'adjustHeight': {
          // 前端在展开/收起内联动作面板时通知主进程调整窗口高度
          const height = Number(payload?.height || 0)
          if (height > 0 && this.windowManager) {
            this.windowManager.adjustHeight(height)
          }
          return { success: true }
        }

        case 'copyInput': {
          // 复制当前捕获的选中文本到用户剪贴板
          if (this.capturedText) {
            clipboard.writeText(this.capturedText)
          }
          return { success: true }
        }

        case 'disableRecommend': {
          // 使用统一的 PluginCommandDisabledManager 机制禁用 feature 的所有命令
          // 这样在设置中心 UI 中也能看到禁用状态，且用户可以重新启用
          const pluginId = String(payload?.pluginId || '')
          const featureCode = String(payload?.featureCode || '')
          if (!pluginId || !featureCode) {
            return { success: false, error: '缺少参数' }
          }
          // 获取该 feature 的所有 cmds 并逐条禁用
          const cmds = this.pluginManager.listCommands(pluginId)
            .filter((c) => c.featureCode === featureCode)
          for (const cmd of cmds) {
            this.pluginManager.setCommandDisabled({
              pluginId,
              featureCode,
              cmdId: cmd.cmdId,
              cmdSignature: cmd.cmdSignature,
              disabled: true
            })
          }
          this.store.unpin(pluginId, featureCode) // 同时取消固定
          log.info(`[SuperPanel] 已禁用推荐: ${pluginId}:${featureCode} (${cmds.length} 条命令)`)
          // 刷新面板（从当前结果中移除该项）
          // 有文本或有附件时都需要刷新（附件模式下 capturedText 为空）
          if (this.capturedText || this.cachedAttachments.length > 0) {
            this.refreshPanel()
          }
          return { success: true }
        }

        case 'viewPlugin': {
          // 关闭面板，通过已有的设置中心 IPC 通道打开插件管理页
          const pluginId = String(payload?.pluginId || '')
          if (!pluginId) {
            return { success: false, error: '缺少插件 ID' }
          }
          this.hidePanel()
          try {
            const mainWindow = this.getMainWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
              if (mainWindow.isMinimized()) mainWindow.restore()
              mainWindow.show()
              mainWindow.focus()
              mainWindow.webContents.send('app:openPluginManager', pluginId)
            }
          } catch (err) {
            log.warn('[SuperPanel] 跳转插件详情失败:', err)
          }
          return { success: true }
        }

        default:
          return { success: false, error: `未知动作: ${action}` }
      }
    } catch (err) {
      log.error('[SuperPanel] handleAction 异常:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  // ==================== 固定列表（分组化） ====================

  /**
   * 构建分组化固定列表（验证插件是否存在且启用）
   *
   * 基于当前前台应用上下文，筛选全局分组和匹配应用的分组。
   */
  private buildPinnedGroups(): SuperPanelGroup[] {
    // 复用触发时缓存的前台应用上下文，避免获取到 Mulby 自己
    const app = this.cachedActiveWindow?.app
    const bundleId = this.cachedActiveWindow?.bundleId

    const groups = this.store.getGroupsForApp(app, bundleId)
    const validGroups: SuperPanelGroup[] = []

    for (const group of groups) {
      const validItems: SuperPanelPinnedItem[] = []

      for (const item of group.items) {
        const plugin = this.pluginManager.get(item.pluginId)
        if (!plugin || !plugin.enabled) continue

        // 使用 getFeatures 包含动态特性，与 matchContent 保持一致
        const features = this.pluginManager.getFeatures(item.pluginId)
        const feature = features.find((f) => f.code === item.featureCode)
        if (!feature) continue

        // 同步显示名称
        const displayName = feature.explain || feature.code
        const pluginIcon = this.resolvePluginIcon(plugin)
        this.store.syncPinnedItemMeta(item.pluginId, item.featureCode, displayName, pluginIcon)

        validItems.push({
          ...item,
          displayName,
          pluginIcon
        })
      }

      validGroups.push({
        ...group,
        items: validItems
      })
    }

    return validGroups
  }

  // ==================== 二次搜索 ====================

  /** 在缓存的匹配结果中按关键词过滤 */
  private filterItems(query: string): SuperPanelItem[] {
    if (!query) return this.cachedItems

    const lowerQuery = query.toLowerCase()
    return this.cachedItems.filter((item) => {
      return (
        item.featureExplain.toLowerCase().includes(lowerQuery) ||
        item.pluginDisplayName.toLowerCase().includes(lowerQuery) ||
        item.pluginName.toLowerCase().includes(lowerQuery) ||
        item.featureCode.toLowerCase().includes(lowerQuery) ||
        item.matchType.toLowerCase().includes(lowerQuery)
      )
    })
  }

  // ==================== 即时翻译 ====================

  /**
   * 异步请求 AI 翻译，结果通过 IPC 增量推送到面板
   *
   * 策略：
   * - 检测输入语言（CJK → 英文，其他 → 中文）
   * - 限制输入长度（可配置，默认 ≤ 5000 字符）
   * - 使用序号机制丢弃过时请求
   * - 禁用所有工具/技能/MCP，确保纯文本翻译
   */
  private async requestTranslation(text: string): Promise<void> {
    const trimmed = text.trim()
    const settings = this.getSettings()
    const maxLength = settings.translationMaxLength ?? 5000
    if (!trimmed || trimmed.length > maxLength) return

    // 检查 AI 是否已配置
    try {
      const { getAiSettings } = await import('../ai/config')
      const aiSettings = getAiSettings()
      const hasProvider = aiSettings.providers.some((p) => p.apiKey && p.apiKey.length > 0)
      if (!hasProvider) return
    } catch {
      return
    }

    const seq = ++this.translationSeq

    // 推送 loading 状态
    this.pushTranslation({ text: '', loading: true })

    try {
      // 检测目标语言：包含 CJK 字符 → 翻译为英文，否则翻译为中文
      const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(trimmed)
      const targetLang = hasCJK ? '英文 (English)' : '简体中文'

      // 根据输入长度动态计算 maxOutputTokens：
      // 翻译输出通常不超过输入的 2 倍（跨语言膨胀），每字符约 0.5-1.5 token
      // 下限 500 token，上限 16000 token
      const estimatedOutputTokens = Math.max(500, Math.min(Math.ceil(trimmed.length * 2), 16000))

      const response = await aiService.call({
        messages: [
          {
            role: 'system',
            content: '你是一个翻译助手。直接输出翻译结果，不要包含任何解释、标注或额外文字。'
          },
          {
            role: 'user',
            content: `将以下文本翻译为${targetLang}：\n\n${trimmed}`
          }
        ],
        // 纯文本翻译：彻底禁用所有工具、技能和 MCP
        // - enableInternalTools: false 阻止内部能力注入（shell.exec, fs.read 等）
        // - capabilities: [] 不请求任何能力
        // - skills/mcp off 不加载技能和 MCP 工具
        toolingPolicy: { enableInternalTools: false },
        capabilities: [],
        skills: { mode: 'off' },
        mcp: { mode: 'off' },
        params: { maxOutputTokensEnabled: true, maxOutputTokens: estimatedOutputTokens }
      })

      // 丢弃过时结果
      if (seq !== this.translationSeq) return

      const rawContent = response.content
      const translated = (typeof rawContent === 'string' ? rawContent : '').trim()
      if (translated) {
        this.pushTranslation({ text: translated, loading: false })
      } else {
        this.pushTranslation({ text: '', loading: false, error: '翻译结果为空' })
      }
    } catch (err) {
      if (seq !== this.translationSeq) return
      this.pushTranslation({
        text: '',
        loading: false,
        error: err instanceof Error ? err.message : '翻译失败'
      })
    }
  }

  /** 推送翻译状态到面板 */
  private pushTranslation(translation: SuperPanelTranslation): void {
    if (!this.windowManager) return
    this.currentTranslation = translation
    this.pushState({
      capturedText: this.capturedText,
      items: this.cachedItems,
      visible: true,
      mode: 'match',
      translation,
      activeApp: this.cachedActiveWindow
        ? { app: this.cachedActiveWindow.app, bundleId: this.cachedActiveWindow.bundleId }
        : undefined
    })
  }

  /** 推送完整状态到面板窗口 */
  private pushState(state: SuperPanelState): void {
    if (!this.windowManager) return
    this.windowManager.pushState(state)
  }

  /** 重新匹配并刷新面板状态（禁用推荐后立即更新列表） */
  private refreshPanel(): void {
    // 有文本或有附件时都允许刷新（附件模式下 capturedText 为空）
    if (!this.windowManager || (!this.capturedText && this.cachedAttachments.length === 0)) return
    const settings = this.settingsManager.getSettings().superPanel
    this.cachedItems = this.matchContent(this.capturedText, settings.maxItems ?? 8)
    
    // 如果存在活跃搜索词，则重新过滤
    const itemsToPush = this.currentQuery ? this.filterItems(this.currentQuery) : this.cachedItems

    this.pushState({
      capturedText: this.capturedText,
      items: itemsToPush,
      visible: true,
      mode: 'match',
      translation: this.currentTranslation || undefined,
      activeApp: this.cachedActiveWindow
        ? { app: this.cachedActiveWindow.app, bundleId: this.cachedActiveWindow.bundleId }
        : undefined
    })
  }

  // ==================== 辅助方法 ====================

  private getSettings(): SuperPanelSettings {
    return this.settingsManager.getSettings().superPanel
  }

  private unregisterHooks(): void {
    this.inputHookService.unregisterMouse(HOOK_ID)
    this.inputHookService.unregister(HOOK_ID)
    // 使用追踪的 modifier 注销（而非从当前设置读取，因为设置可能已变更）
    if (this.registeredDoubleTapModifier) {
      this.inputHookService.unregisterDoubleTap(this.registeredDoubleTapModifier)
      this.registeredDoubleTapModifier = null
    }
  }
}
