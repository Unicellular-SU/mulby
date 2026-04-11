/**
 * 超级面板核心控制器
 *
 * 调度超级面板的完整生命周期：
 * 1. 鼠标/键盘/双击修饰键手势监听
 * 2. 应用黑名单过滤（通过 ActiveWindow 缓存）
 * 3. 静默取词（原生 Cmd/Ctrl+C + 剪贴板快照比较）
 * 4. 匹配引擎查询（复用 search-matcher）
 * 5. 面板窗口管理（委托 SuperPanelWindowManager）
 * 6. 剪贴板隔离与恢复
 */

import { clipboard, screen } from 'electron'
import type { InputHookService, MouseEventData } from './input-hook'
import type { PluginManager } from '../plugin'
import type { AppSettingsManager } from './app-settings'
import type { ThemeManager } from './theme'
import type { SuperPanelSettings } from '../../shared/types/settings'
import { getCachedActiveWindow } from './active-window'
import { nativeSimulateCopy, fallbackSimulateCopy } from './native-keyboard-sim'
import { findBestMatch } from '../../shared/search-matcher'
import type { Plugin, InputPayload } from '../../shared/types/plugin'
import { SuperPanelWindowManager } from './super-panel-window'
import { SuperPanelStore, type SuperPanelPinnedItem } from './super-panel-store'
import { aiService } from '../ai'

// ==================== 类型定义 ====================

/** 剪贴板完整快照（隔离所有格式） */
interface ClipboardSnapshot {
  text: string
  html: string
  rtf: string
  bookmark: { title: string; url: string } | null
  hasImage: boolean
  /** 原始 NativeImage（仅在有图片时保存） */
  image: Electron.NativeImage | null
}

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
  /** 固定列表数据（mode='pinned' 时有效） */
  pinnedItems?: SuperPanelPinnedItem[]
  /** 即时翻译结果（异步推送） */
  translation?: SuperPanelTranslation
}

// 钩子注册 ID
const HOOK_ID = 'super-panel'

// ==================== SuperPanelManager ====================

export class SuperPanelManager {
  private windowManager: SuperPanelWindowManager | null = null
  private isActive = false
  private capturedText = ''
  // 剪贴板隔离：保存触发前的剪贴板快照用于恢复
  private savedClipboard: ClipboardSnapshot | null = null
  // 标记是否已执行过一次静默取词（仅取词后才需要恢复剪贴板）
  private hasCaptured = false
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

  constructor(
    private readonly inputHookService: InputHookService,
    private readonly pluginManager: PluginManager,
    private readonly settingsManager: AppSettingsManager,
    private readonly themeManager: ThemeManager
  ) {}

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
    console.log(`[SuperPanel] 已启用，触发方式: ${trigger.type}`)
  }

  /** 禁用超级面板 */
  disable(): void {
    this.unregisterHooks()
    // 禁用时仅隐藏面板，不恢复剪贴板（可能没有快照，否则会写空值）
    if (this.windowManager) {
      this.windowManager.hide()
    }
    this.isActive = false
    console.log('[SuperPanel] 已禁用')
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
   * 核心工作流：静默取词 → 匹配 → 显示面板
   *
   * 时序：
   * 1. 保存当前剪贴板内容 (< 1ms)
   * 2. 原生模拟 Cmd/Ctrl+C (< 5ms)
   * 3. 等待剪贴板更新 + 读取 (50-100ms)
   * 4. 比较差异，执行匹配 (< 5ms)
   * 5. 显示面板 + IPC 推送 (< 50ms)
   * 6. 异步翻译（不阻塞面板显示）
   */
  private async triggerWorkflow(x: number, y: number): Promise<void> {
    try {
      // 1. 保存旧剪贴板完整快照
      this.savedClipboard = this.snapshotClipboard()

      // 2. 静默复制（零延迟原生调用）
      // 在模拟复制前设置抑制窗口：macOS CGEventTap 会异步捕获模拟的 Cmd+C 事件，
      // 其中 C 键 (vk=67) 的 keydown 会在 10-50ms 后到达并污染 DoubleTap 状态。
      // 抑制窗口确保该合成事件被忽略。
      this.inputHookService.suppressDoubleTapForSyntheticInput(100)

      let copySuccess = nativeSimulateCopy()
      if (!copySuccess) {
        copySuccess = await fallbackSimulateCopy()
      }

      if (!copySuccess) {
        console.warn('[SuperPanel] 静默复制失败')
        return
      }

      // 3. 等待剪贴板更新
      const settings = this.getSettings()
      const newText = await this.pollClipboard(
        this.savedClipboard?.text || '',
        settings.clipboardPollDelayMs
      )

      // 4. 判断是否有新内容
      const oldText = this.savedClipboard?.text || ''
      const hasNewContent = newText !== null && newText !== oldText
      this.capturedText = hasNewContent ? newText! : ''
      this.hasCaptured = true

      if (this.capturedText.trim().length > 0) {
        // ===== 有选中文本 → 匹配模式 =====
        // 递增翻译序号，使之前在途的翻译请求结果被丢弃
        this.translationSeq++
        const items = this.matchContent(this.capturedText, settings.maxItems)
        this.cachedItems = items

        this.showPanel(x, y, {
          capturedText: this.capturedText,
          items,
          visible: true,
          mode: 'match'
        })

        // 6. 异步翻译（不阻塞面板显示）
        if (settings.instantTranslation) {
          void this.requestTranslation(this.capturedText)
        }
      } else {
        // ===== 无选中文本 → 固定列表模式 =====
        // 递增翻译序号，确保之前触发的翻译不会污染当前 pinned 面板
        this.translationSeq++
        const pinnedItems = this.buildPinnedItems()
        this.cachedItems = []

        // 无固定项也不显示面板
        if (pinnedItems.length === 0) return

        this.showPanel(x, y, {
          capturedText: '',
          items: [],
          visible: true,
          mode: 'pinned',
          pinnedItems
        })
      }
    } catch (err) {
      console.error('[SuperPanel] 触发工作流异常:', err)
    }
  }

  // ==================== 剪贴板操作 ====================

  /**
   * 轮询检测剪贴板变化
   *
   * @param oldText 模拟复制前的剪贴板内容
   * @param maxWaitMs 最大等待时间
   * @returns 新的剪贴板文本，若超时未变化则返回 null
   */
  private async pollClipboard(oldText: string, maxWaitMs: number): Promise<string | null> {
    const startTime = Date.now()
    const pollInterval = 10 // 10ms 间隔轮询

    while (Date.now() - startTime < maxWaitMs) {
      await this.sleep(pollInterval)
      const current = clipboard.readText() || ''
      if (current !== oldText) {
        return current
      }
    }

    // 超时：返回当前剪贴板内容（可能未被选中内容覆盖）
    return clipboard.readText() || null
  }

  /** 保存剪贴板完整快照 */
  private snapshotClipboard(): ClipboardSnapshot {
    const text = clipboard.readText() || ''
    const html = clipboard.readHTML() || ''
    const rtf = clipboard.readRTF() || ''
    let bookmark: { title: string; url: string } | null = null
    try {
      const bm = clipboard.readBookmark()
      if (bm && bm.url) bookmark = bm
    } catch { /* 部分平台不支持 */ }
    const image = clipboard.readImage()
    const hasImage = image && !image.isEmpty()
    return {
      text,
      html,
      rtf,
      bookmark,
      hasImage: !!hasImage,
      image: hasImage ? image : null
    }
  }

  /** 恢复剪贴板（面板关闭时调用） */
  restoreClipboard(): void {
    // 仅在实际执行过静默取词后才恢复
    if (!this.hasCaptured || !this.savedClipboard) return
    try {
      const snap = this.savedClipboard
      // 优先恢复富文本格式
      if (snap.hasImage && snap.image) {
        clipboard.writeImage(snap.image)
      } else if (snap.html) {
        clipboard.write({
          text: snap.text,
          html: snap.html,
          rtf: snap.rtf || undefined,
          bookmark: snap.bookmark ? `${snap.bookmark.title}\n${snap.bookmark.url}` : undefined
        })
      } else {
        clipboard.writeText(snap.text)
      }
    } catch (err) {
      console.error('[SuperPanel] 恢复剪贴板失败:', err)
    } finally {
      this.hasCaptured = false
      this.savedClipboard = null
    }
  }

  // ==================== 匹配引擎 ====================

  /** 使用 search-matcher 对捕获内容执行插件匹配，叠加使用频率和搜索偏好 */
  private matchContent(text: string, maxItems: number): SuperPanelItem[] {
    if (!text || text.trim().length === 0) return []

    const activeWindow = getCachedActiveWindow() || undefined
    const input: InputPayload = {
      text,
      attachments: [],
      activeWindow
    }

    const results: SuperPanelItem[] = []
    const plugins = this.pluginManager.getAll()

    for (const plugin of plugins) {
      if (!plugin.enabled) continue

      for (const feature of plugin.manifest.features) {
        const match = findBestMatch(feature, input)
        if (!match) continue

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
          score: match.score
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

    // 综合排序：偏好置顶 > 分数 + 使用频率权重
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
        return (b.score + bBoost) - (a.score + aBoost)
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
    // 恢复剪贴板
    this.restoreClipboard()
  }

  /** 确保窗口管理器已初始化 */
  private ensureWindowManager(): SuperPanelWindowManager {
    if (!this.windowManager) {
      this.windowManager = new SuperPanelWindowManager({
        themeManager: this.themeManager,
        onAction: (action, payload) => this.handleAction(action, payload),
        onHide: () => this.restoreClipboard()
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
          // 将捕获的文本传入插件执行
          const result = await this.pluginManager.run(pluginId, featureCode, this.capturedText)
          return { success: result.success, error: result.error }
        }

        case 'close':
          this.hidePanel()
          return { success: true }

        case 'search': {
          // 二次搜索：在缓存的匹配结果中过滤
          const query = String(payload?.query || '').trim()
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
          // 刷新固定列表
          const pinnedItems = this.buildPinnedItems()
          this.pushState({
            capturedText: '',
            items: [],
            visible: true,
            mode: 'pinned',
            pinnedItems
          })
          return { success: true }
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

        default:
          return { success: false, error: `未知动作: ${action}` }
      }
    } catch (err) {
      console.error('[SuperPanel] handleAction 异常:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  // ==================== 固定列表 ====================

  /** 构建固定列表（验证插件是否存在且启用） */
  private buildPinnedItems(): SuperPanelPinnedItem[] {
    const pinned = this.store.getPinnedItems()
    const valid: SuperPanelPinnedItem[] = []

    for (const item of pinned) {
      const plugins = this.pluginManager.getAll()
      const plugin = plugins.find((p) => p.id === item.pluginId)
      if (!plugin || !plugin.enabled) continue

      const feature = plugin.manifest.features.find((f) => f.code === item.featureCode)
      if (!feature) continue

      // 同步显示名称
      const displayName = feature.explain || feature.code
      const pluginIcon = this.resolvePluginIcon(plugin)
      this.store.syncPinnedItemMeta(item.pluginId, item.featureCode, displayName, pluginIcon)

      valid.push({
        ...item,
        displayName,
        pluginIcon
      })
    }

    return valid
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
   * - 限制输入长度 ≤ 500 字符
   * - 使用序号机制丢弃过时请求
   */
  private async requestTranslation(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length > 500) return

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
        params: { maxOutputTokensEnabled: true, maxOutputTokens: 500 }
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
      translation
    })
  }

  /** 推送完整状态到面板窗口 */
  private pushState(state: SuperPanelState): void {
    if (!this.windowManager) return
    this.windowManager.pushState(state)
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
