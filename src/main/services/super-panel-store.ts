/**
 * 超级面板持久化层
 *
 * 管理超级面板的本地数据：
 * - 固定列表 (pinnedItems) — 用户手动固定到面板的常用插件功能
 * - 搜索偏好 (preferences) — 记住用户对特定选中内容的偏好选择
 *
 * 存储：userData/super-panel-store.json，启动时加载到内存。
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

/** 固定到超级面板的插件功能条目 */
export interface SuperPanelPinnedItem {
  pluginId: string
  featureCode: string
  /** 显示名称（快照，插件更新后自动同步） */
  displayName: string
  /** 插件图标（快照） */
  pluginIcon?: string
  /** 固定时间戳 */
  pinnedAt: number
}

/** 搜索偏好值 */
interface PreferenceEntry {
  pluginId: string
  featureCode: string
}

/** 持久化文件结构 */
interface SuperPanelStoreData {
  pinnedItems: SuperPanelPinnedItem[]
  /** key = 选中文本前 100 字符的简易 hash */
  preferences: Record<string, PreferenceEntry>
}

const MAX_PREFERENCES = 200

export class SuperPanelStore {
  private filePath: string
  private pinnedItems: SuperPanelPinnedItem[] = []
  private preferences: Record<string, PreferenceEntry> = {}

  constructor() {
    this.filePath = join(app.getPath('userData'), 'super-panel-store.json')
    this.load()
  }

  // ==================== 固定列表 ====================

  /** 获取全部固定项 */
  getPinnedItems(): SuperPanelPinnedItem[] {
    return [...this.pinnedItems]
  }

  /** 添加固定项（去重） */
  pin(item: Omit<SuperPanelPinnedItem, 'pinnedAt'>): boolean {
    const exists = this.pinnedItems.some(
      (p) => p.pluginId === item.pluginId && p.featureCode === item.featureCode
    )
    if (exists) return false

    this.pinnedItems.push({
      ...item,
      pinnedAt: Date.now()
    })
    this.save()
    return true
  }

  /** 取消固定 */
  unpin(pluginId: string, featureCode: string): boolean {
    const before = this.pinnedItems.length
    this.pinnedItems = this.pinnedItems.filter(
      (p) => !(p.pluginId === pluginId && p.featureCode === featureCode)
    )
    if (this.pinnedItems.length < before) {
      this.save()
      return true
    }
    return false
  }

  /** 检查是否已固定 */
  isPinned(pluginId: string, featureCode: string): boolean {
    return this.pinnedItems.some(
      (p) => p.pluginId === pluginId && p.featureCode === featureCode
    )
  }

  /** 同步固定项的显示名称和图标（插件更新后调用） */
  syncPinnedItemMeta(pluginId: string, featureCode: string, displayName: string, pluginIcon?: string): void {
    const item = this.pinnedItems.find(
      (p) => p.pluginId === pluginId && p.featureCode === featureCode
    )
    if (item && (item.displayName !== displayName || item.pluginIcon !== pluginIcon)) {
      item.displayName = displayName
      item.pluginIcon = pluginIcon
      this.save()
    }
  }

  // ==================== 搜索偏好 ====================

  /** 记录用户对某段选中文本的偏好选择 */
  recordPreference(text: string, pluginId: string, featureCode: string): void {
    const key = this.hashText(text)
    this.preferences[key] = { pluginId, featureCode }

    // 限制存储上限：超出时删除最早的（按 key 顺序）
    const keys = Object.keys(this.preferences)
    if (keys.length > MAX_PREFERENCES) {
      const toDelete = keys.slice(0, keys.length - MAX_PREFERENCES)
      for (const k of toDelete) {
        delete this.preferences[k]
      }
    }

    this.save()
  }

  /** 获取某段文本的偏好选择 */
  getPreference(text: string): PreferenceEntry | null {
    const key = this.hashText(text)
    return this.preferences[key] || null
  }

  // ==================== 内部方法 ====================

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw) as Partial<SuperPanelStoreData>
      this.pinnedItems = this.normalizePinnedItems(data.pinnedItems)
      this.preferences = this.normalizePreferences(data.preferences)
    } catch {
      this.pinnedItems = []
      this.preferences = {}
    }
  }

  private save(): void {
    const data: SuperPanelStoreData = {
      pinnedItems: this.pinnedItems,
      preferences: this.preferences
    }
    try {
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[SuperPanelStore] 保存失败:', err)
    }
  }

  /** 对选中文本生成简易 hash（前 100 字符 → 基于长度+字符码的数字 hash） */
  private hashText(text: string): string {
    const trimmed = text.trim().slice(0, 100)
    let hash = 0
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed.charCodeAt(i)
      hash = ((hash << 5) - hash + char) | 0
    }
    return `sp_${hash.toString(36)}`
  }

  private normalizePinnedItems(input: unknown): SuperPanelPinnedItem[] {
    if (!Array.isArray(input)) return []
    const items: SuperPanelPinnedItem[] = []
    for (const entry of input) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Partial<SuperPanelPinnedItem>
      if (!item.pluginId || !item.featureCode) continue
      items.push({
        pluginId: item.pluginId,
        featureCode: item.featureCode,
        displayName: item.displayName || item.featureCode,
        pluginIcon: item.pluginIcon,
        pinnedAt: typeof item.pinnedAt === 'number' ? item.pinnedAt : Date.now()
      })
    }
    return items
  }

  private normalizePreferences(input: unknown): Record<string, PreferenceEntry> {
    if (!input || typeof input !== 'object') return {}
    const result: Record<string, PreferenceEntry> = {}
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as Partial<PreferenceEntry>
      if (!entry.pluginId || !entry.featureCode) continue
      result[key] = { pluginId: entry.pluginId, featureCode: entry.featureCode }
    }
    return result
  }
}
