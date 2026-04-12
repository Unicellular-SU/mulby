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
import type { ClipboardHistoryManager } from './clipboard-history'
import { getCachedActiveWindow } from './active-window'
import { nativeSimulateCopy, fallbackSimulateCopy } from './native-keyboard-sim'
import { findBestMatch, matchesWindow } from '../../shared/search-matcher'
import type { Plugin, InputPayload, InputAttachment, ActiveWindowInfo } from '../../shared/types/plugin'
import { SuperPanelWindowManager } from './super-panel-window'
import { SuperPanelStore, type SuperPanelPinnedItem, type SuperPanelGroup } from './super-panel-store'
import { aiService } from '../ai'
import { basename, extname } from 'path'
import { getClipboardFormat, readClipboardFiles } from '../utils/clipboard-helper'

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
  /** 复制前剪贴板中的文件列表（用于 before/after 对比） */
  files: string[]
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
  private currentQuery?: string // 当前二次过滤词，用于保留禁用项时的过滤状态

  // 缓存的附件列表（文件/图片），用于传递给插件
  private cachedAttachments: InputAttachment[] = []
  // 缓存触发时的前台应用上下文（面板打开期间复用，避免获取到 Mulby 自己）
  private cachedActiveWindow: ActiveWindowInfo | undefined = undefined

  constructor(
    private readonly inputHookService: InputHookService,
    private readonly pluginManager: PluginManager,
    private readonly settingsManager: AppSettingsManager,
    private readonly themeManager: ThemeManager,
    private readonly clipboardHistoryManager?: ClipboardHistoryManager
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
   * 2. 暂停剪贴板历史采样（防止污染）
   * 3. 原生模拟 Cmd/Ctrl+C (< 5ms)
   * 4. 等待剪贴板更新 + 读取 (50-100ms)
   * 5. 解析文件/图片附件
   * 6. 比较差异，执行匹配 (< 5ms)
   * 7. 显示面板 + IPC 推送 (< 50ms)
   * 8. 异步翻译（不阻塞面板显示）
   * 9. 面板关闭时恢复剪贴板并恢复采样
   *
   * 剪贴板历史暂停策略：
   * pause() 从模拟复制前到 restoreClipboard() 完成期间一直生效。
   * 这样无论 watcher 是原生事件驱动还是 1s 轮询回退，临时内容都不会被记录。
   * 安全超时 30s 仅作为代码 bug 的最终保护，正常流程中 resume() 一定在面板关闭时被调用。
   */
  private async triggerWorkflow(x: number, y: number): Promise<void> {
    try {
      // 1. 保存旧剪贴板完整快照
      this.savedClipboard = this.snapshotClipboard()

      // 2. 暂停剪贴板历史采样
      //    从这里开始一直到 restoreClipboard() 恢复剪贴板后才 resume，
      //    保证临时复制内容在整个面板生命周期中都不会被轮询式 watcher 记录
      this.clipboardHistoryManager?.pause()

      // 3. 静默复制（零延迟原生调用）
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
        this.clipboardHistoryManager?.resume()
        return
      }

      // 4. 等待剪贴板更新
      const settings = this.getSettings()
      const newText = await this.pollClipboard(
        this.savedClipboard?.text || '',
        settings.clipboardPollDelayMs
      )

      // 5. 解析文件/图片附件（带 before/after 验证，避免匹配旧的剪贴板文件/图片）
      this.cachedAttachments = this.parseClipboardAttachments(this.savedClipboard)

      // 注意：此处不 resume()！
      // 临时复制内容仍在剪贴板上，必须保持暂停直到面板关闭后 restoreClipboard() 恢复原始内容

      // 6. 判断是否有新内容（文本或附件）
      const oldText = this.savedClipboard?.text || ''
      const hasNewContent = newText !== null && newText !== oldText
      this.capturedText = hasNewContent ? newText! : ''
      this.hasCaptured = true

      const hasNewAttachments = this.cachedAttachments.length > 0

      if (this.capturedText.trim().length > 0 || hasNewAttachments) {
        // ===== 有选中文本或附件 → 匹配模式 =====
        // 清除过滤词和上一次触发的翻译结果
        this.currentQuery = undefined
        this.currentTranslation = undefined
        // 递增翻译序号，使之前在途的翻译请求结果被丢弃
        this.translationSeq++
        // 获取当前前台应用上下文
        const activeWindowInfo = getCachedActiveWindow()
        // 缓存触发时的前台应用（面板打开期间复用，避免获取到 Mulby 自己）
        // 必须在 matchContent() 之前赋值，matchContent 内部读取 this.cachedActiveWindow
        this.cachedActiveWindow = activeWindowInfo || undefined

        const items = this.matchContent(this.capturedText, settings.maxItems)
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

        // 8. 异步翻译（不阻塞面板显示，仅文本模式）
        if (settings.instantTranslation && this.capturedText.trim().length > 0) {
          void this.requestTranslation(this.capturedText)
        }
      } else {
        // ===== 无选中文本 → 固定列表模式 =====
        // 递增翻译序号，确保之前触发的翻译不会污染当前 pinned 面板
        this.translationSeq++
        // 缓存触发时前台应用上下文（pinned 模式也需要用于应用绑定分组筛选）
        const activeWindowInfo = getCachedActiveWindow()
        this.cachedActiveWindow = activeWindowInfo || undefined
        const pinnedGroups = this.buildPinnedGroups()
        this.cachedItems = []

        // 无固定项也不显示面板
        const hasAnyItem = pinnedGroups.some((g) => g.items.length > 0)
        if (!hasAnyItem) {
          this.clipboardHistoryManager?.resume()
          return
        }

        // 构建兼容的扁平列表（供旧逻辑使用）
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
      console.error('[SuperPanel] 触发工作流异常:', err)
      // 确保异常时也恢复剪贴板历史采样
      this.clipboardHistoryManager?.resume()
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
    // 快照当前文件列表（用于附件 before/after 对比）
    let files: string[] = []
    try {
      if (getClipboardFormat() === 'files') {
        files = readClipboardFiles()
      }
    } catch { /* 忽略 */ }
    return {
      text,
      html,
      rtf,
      bookmark,
      hasImage: !!hasImage,
      image: hasImage ? image : null,
      files
    }
  }

  /** 恢复剪贴板（面板关闭时调用） */
  restoreClipboard(): void {
    // 仅在实际执行过静默取词后才恢复
    if (!this.hasCaptured || !this.savedClipboard) return
    try {
      // 恢复剪贴板内容时短暂抑制采样（避免恢复操作本身被记录为新的剪贴板事件）
      this.clipboardHistoryManager?.pause()
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
      // 恢复采样（暂停窗口仅 ~5ms，不会触发安全超时）
      this.clipboardHistoryManager?.resume()
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

  /**
   * 解析剪贴板中的文件和图片为 InputAttachment 列表
   *
   * 通过 before/after 对比避免匹配旧的剪贴板内容：
   * - 文件：对比模拟复制前后的文件列表
   * - 图片：对比模拟复制前后是否新增了图片
   */
  private parseClipboardAttachments(savedSnapshot: ClipboardSnapshot | null): InputAttachment[] {
    const attachments: InputAttachment[] = []
    try {
      const format = getClipboardFormat()

      if (format === 'files') {
        const files = readClipboardFiles()
        // before/after 验证：对比复制前快照中保存的文件列表
        if (savedSnapshot && savedSnapshot.files.length > 0) {
          const oldFiles = savedSnapshot.files
          // 如果复制前后文件列表完全相同，说明没有新选中文件
          if (files.length === oldFiles.length &&
              files.every((f, i) => f === oldFiles[i])) {
            return [] // 文件未变化，是旧剪贴板内容
          }
        }

        for (const filePath of files) {
          // 跨平台：用 path.basename 正确提取文件名（兼容 Windows 反斜杠路径）
          const name = basename(filePath)
          const ext = extname(filePath)
          // 图片扩展名判断
          const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']
          const isImage = imageExts.some(e => ext.toLowerCase() === e)

          attachments.push({
            id: `sp_file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name,
            size: 0, // 统计大小需要同步 IO，这里先留 0，后续可惰性加载
            kind: isImage ? 'image' : 'file',
            ext,
            path: filePath
          })
        }
      } else if (format === 'image') {
        // before/after 验证：如果模拟复制前剪贴板就有图片，说明不是新选中的
        if (savedSnapshot?.hasImage) {
          return [] // 复制前就有图片，是旧剪贴板内容
        }

        // 纯图片剪贴板内容（截图、复制图片等）
        const image = clipboard.readImage()
        if (image && !image.isEmpty()) {
          const pngBuffer = image.toPNG()
          const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
          attachments.push({
            id: `sp_img_${Date.now()}`,
            name: 'clipboard-image.png',
            size: pngBuffer.length,
            kind: 'image',
            ext: '.png',
            dataUrl
          })
        }
      }
    } catch (err) {
      console.error('[SuperPanel] 解析剪贴板附件失败:', err)
    }
    return attachments
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
          // 用户显式复制了翻译结果，跳过后续剪贴板恢复（否则 blur/close 会覆盖用户复制的内容）
          this.hasCaptured = false
          this.savedClipboard = null
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
            // 有实际内容写入时，清除状态跳过 restoreClipboard 的覆写，并手动 resume
            this.hasCaptured = false
            this.savedClipboard = null
            this.clipboardHistoryManager?.resume()
          }
          // 无捕获文本时不清除状态，保留 restoreClipboard 能力
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
          console.log(`[SuperPanel] 已禁用推荐: ${pluginId}:${featureCode} (${cmds.length} 条命令)`)
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
            const { BrowserWindow: BW } = require('electron')
            // 仅排除面板窗口，兼容 dev server（URL 不含 index.html）
            const panelWindowId = this.windowManager?.getWindowId()
            const mainWindow = BW.getAllWindows().find(
              (w: Electron.BrowserWindow) => !w.isDestroyed() && w.id !== panelWindowId
            )
            if (mainWindow) {
              if (mainWindow.isMinimized()) mainWindow.restore()
              mainWindow.show()
              mainWindow.focus()
              // 打开插件管理页面，让用户查看插件详情
              mainWindow.webContents.send('app:openPluginManager', pluginId)
            }
          } catch (err) {
            console.warn('[SuperPanel] 跳转插件详情失败:', err)
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
