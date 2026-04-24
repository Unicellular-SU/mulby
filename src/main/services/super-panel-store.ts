/**
 * 超级面板持久化层
 *
 * 管理超级面板的本地数据：
 * - 固定列表布局 (layout) — 支持分组、排序、应用绑定的升级数据结构
 * - 搜索偏好 (preferences) — 记住用户对特定选中内容的偏好选择
 *
 * 数据版本：
 * - v1: pinnedItems[] 扁平数组（已弃用，启动时自动迁移）
 * - v2: SuperPanelLayout { groups[] } 分组结构
 *
 * 存储：userData/super-panel-store.json，启动时加载到内存。
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import log from 'electron-log'

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

/** 固定项分组 */
export interface SuperPanelGroup {
  /** 分组唯一 ID */
  id: string
  /** 分组名称 */
  name: string
  /** 绑定的应用（app 名称或 bundleId），为空表示全局分组 */
  boundApp?: string
  /** 分组内的固定项（有序） */
  items: SuperPanelPinnedItem[]
  /** 分组创建时间 */
  createdAt: number
}

/** 超级面板布局（v2 持久化根结构） */
export interface SuperPanelLayout {
  /** 版本号，用于数据迁移 */
  version: 2
  /** 分组列表（有序） */
  groups: SuperPanelGroup[]
}

/** 搜索偏好值 */
interface PreferenceEntry {
  pluginId: string
  featureCode: string
}

/** 持久化文件结构 */
interface SuperPanelStoreData {
  /** v2: 布局结构 */
  layout?: SuperPanelLayout
  /** key = 选中文本前 100 字符的简易 hash */
  preferences: Record<string, PreferenceEntry>
  /** 旧字段（仅用于 v1→v2 迁移） */
  pinnedItems?: SuperPanelPinnedItem[]
}

const MAX_PREFERENCES = 200
const DEFAULT_GROUP_ID = 'default'
const DEFAULT_GROUP_NAME = '常用'

export class SuperPanelStore {
  private filePath: string
  private layout: SuperPanelLayout = { version: 2, groups: [] }
  private preferences: Record<string, PreferenceEntry> = {}

  constructor() {
    this.filePath = join(app.getPath('userData'), 'super-panel-store.json')
    this.load()
  }

  // ==================== 固定列表（兼容接口） ====================

  /** 获取全部固定项（扁平合并，兼容旧调用方） */
  getPinnedItems(): SuperPanelPinnedItem[] {
    const result: SuperPanelPinnedItem[] = []
    for (const group of this.layout.groups) {
      result.push(...group.items)
    }
    return result
  }

  /**
   * 获取指定应用上下文下的固定项
   *
   * 返回：全局分组（无 boundApp）的条目 + 匹配当前应用的分组条目。
   * 分组内条目保持原始顺序。
   */
  getPinnedItemsForApp(app?: string, bundleId?: string): SuperPanelPinnedItem[] {
    const result: SuperPanelPinnedItem[] = []
    for (const group of this.layout.groups) {
      if (!group.boundApp) {
        // 全局分组：始终显示
        result.push(...group.items)
      } else if (app || bundleId) {
        // 应用绑定分组：匹配 app 名或 bundleId
        const bound = group.boundApp.toLowerCase()
        const matchApp = app && app.toLowerCase() === bound
        const matchBundle = bundleId && bundleId.toLowerCase() === bound
        if (matchApp || matchBundle) {
          result.push(...group.items)
        }
      }
    }
    return result
  }

  /**
   * 获取指定应用上下文下的分组列表（用于前端分组渲染）
   *
   * 返回全局分组 + 匹配当前应用的分组，保留分组元信息。
   */
  getGroupsForApp(app?: string, bundleId?: string): SuperPanelGroup[] {
    return this.layout.groups.filter((group) => {
      if (!group.boundApp) return true // 全局分组
      if (!app && !bundleId) return false
      const bound = group.boundApp.toLowerCase()
      return (app && app.toLowerCase() === bound) ||
             (bundleId && bundleId.toLowerCase() === bound)
    })
  }

  /** 获取全部分组（设置页管理用） */
  getAllGroups(): SuperPanelGroup[] {
    return [...this.layout.groups]
  }

  /** 添加固定项（去重） */
  pin(item: Omit<SuperPanelPinnedItem, 'pinnedAt'>, groupId?: string): boolean {
    // 去重：整个 layout 中不允许重复
    const exists = this.layout.groups.some((g) =>
      g.items.some((p) => p.pluginId === item.pluginId && p.featureCode === item.featureCode)
    )
    if (exists) return false

    const targetGroup = this.ensureGroup(groupId || DEFAULT_GROUP_ID)
    targetGroup.items.push({
      ...item,
      pinnedAt: Date.now()
    })
    this.save()
    return true
  }

  /** 取消固定（从所有分组中移除） */
  unpin(pluginId: string, featureCode: string): boolean {
    let removed = false
    for (const group of this.layout.groups) {
      const before = group.items.length
      group.items = group.items.filter(
        (p) => !(p.pluginId === pluginId && p.featureCode === featureCode)
      )
      if (group.items.length < before) removed = true
    }
    if (removed) this.save()
    return removed
  }

  /** 检查是否已固定 */
  isPinned(pluginId: string, featureCode: string): boolean {
    return this.layout.groups.some((g) =>
      g.items.some((p) => p.pluginId === pluginId && p.featureCode === featureCode)
    )
  }

  /** 同步固定项的显示名称和图标（插件更新后调用） */
  syncPinnedItemMeta(pluginId: string, featureCode: string, displayName: string, pluginIcon?: string): void {
    let changed = false
    for (const group of this.layout.groups) {
      const item = group.items.find(
        (p) => p.pluginId === pluginId && p.featureCode === featureCode
      )
      if (item && (item.displayName !== displayName || item.pluginIcon !== pluginIcon)) {
        item.displayName = displayName
        item.pluginIcon = pluginIcon
        changed = true
      }
    }
    if (changed) this.save()
  }

  // ==================== 分组管理 ====================

  /** 创建新分组，返回分组 ID */
  createGroup(name: string, boundApp?: string): string {
    const id = `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    this.layout.groups.push({
      id,
      name,
      boundApp,
      items: [],
      createdAt: Date.now()
    })
    this.save()
    return id
  }

  /** 删除分组（条目移入默认分组，默认分组本身不可删除） */
  deleteGroup(groupId: string): boolean {
    if (groupId === DEFAULT_GROUP_ID) return false

    const group = this.layout.groups.find((g) => g.id === groupId)
    if (!group) return false

    // 将被删除分组的条目移到默认分组
    const defaultGroup = this.ensureGroup(DEFAULT_GROUP_ID)
    defaultGroup.items.push(...group.items)

    this.layout.groups = this.layout.groups.filter((g) => g.id !== groupId)
    this.save()
    return true
  }

  /** 重命名分组 */
  renameGroup(groupId: string, name: string): boolean {
    const group = this.layout.groups.find((g) => g.id === groupId)
    if (!group || !name.trim()) return false
    group.name = name.trim()
    this.save()
    return true
  }

  /** 更新分组的应用绑定 */
  updateGroupBoundApp(groupId: string, boundApp?: string): boolean {
    const group = this.layout.groups.find((g) => g.id === groupId)
    if (!group) return false
    group.boundApp = boundApp || undefined
    this.save()
    return true
  }

  /** 调整分组内条目顺序 */
  reorderItem(groupId: string, fromIndex: number, toIndex: number): boolean {
    const group = this.layout.groups.find((g) => g.id === groupId)
    if (!group) return false
    if (fromIndex < 0 || fromIndex >= group.items.length) return false
    if (toIndex < 0 || toIndex >= group.items.length) return false
    if (fromIndex === toIndex) return false

    const [moved] = group.items.splice(fromIndex, 1)
    group.items.splice(toIndex, 0, moved)
    this.save()
    return true
  }

  /** 调整分组顺序 */
  reorderGroup(fromIndex: number, toIndex: number): boolean {
    if (fromIndex < 0 || fromIndex >= this.layout.groups.length) return false
    if (toIndex < 0 || toIndex >= this.layout.groups.length) return false
    if (fromIndex === toIndex) return false

    const [moved] = this.layout.groups.splice(fromIndex, 1)
    this.layout.groups.splice(toIndex, 0, moved)
    this.save()
    return true
  }

  /** 将条目移动到目标分组 */
  moveItemToGroup(pluginId: string, featureCode: string, targetGroupId: string): boolean {
    // 先验证目标分组存在，避免移除后发现目标无效而改变布局
    const targetGroup = this.layout.groups.find((g) => g.id === targetGroupId)
    if (!targetGroup) return false

    // 从所有分组中找到并移除该条目
    let movedItem: SuperPanelPinnedItem | null = null
    for (const group of this.layout.groups) {
      const index = group.items.findIndex(
        (p) => p.pluginId === pluginId && p.featureCode === featureCode
      )
      if (index >= 0) {
        movedItem = group.items.splice(index, 1)[0]
        break
      }
    }
    if (!movedItem) return false

    targetGroup.items.push(movedItem)
    this.save()
    return true
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
    if (!existsSync(this.filePath)) {
      // 初始化默认分组
      this.layout = { version: 2, groups: [this.createDefaultGroup()] }
      return
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw) as Partial<SuperPanelStoreData>
      this.layout = this.migrate(data)
      this.preferences = this.normalizePreferences(data.preferences)
    } catch {
      this.layout = { version: 2, groups: [this.createDefaultGroup()] }
      this.preferences = {}
    }
  }

  /**
   * 数据迁移：v1 → v2
   *
   * v1 格式：{ pinnedItems: [...], preferences: {...} }
   * v2 格式：{ layout: { version: 2, groups: [...] }, preferences: {...} }
   */
  private migrate(data: Partial<SuperPanelStoreData>): SuperPanelLayout {
    // 已有 v2 layout → 直接使用并规范化
    if (data.layout?.version === 2) {
      return this.normalizeLayout(data.layout)
    }

    // v1 → v2：将旧 pinnedItems 放入默认分组
    const oldItems = this.normalizePinnedItems(data.pinnedItems)
    log.info(`[SuperPanelStore] v1→v2 数据迁移：${oldItems.length} 个固定项`)
    const layout: SuperPanelLayout = {
      version: 2,
      groups: [{
        id: DEFAULT_GROUP_ID,
        name: DEFAULT_GROUP_NAME,
        items: oldItems,
        createdAt: Date.now()
      }]
    }

    // 迁移后立即保存（清除旧字段）
    this.layout = layout
    this.preferences = this.normalizePreferences(data.preferences)
    this.save()

    return layout
  }

  private save(): void {
    const data: SuperPanelStoreData = {
      layout: this.layout,
      preferences: this.preferences
    }
    try {
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      log.error('[SuperPanelStore] 保存失败:', err)
    }
  }

  /** 确保指定分组存在（不存在时自动创建） */
  private ensureGroup(groupId: string): SuperPanelGroup {
    let group = this.layout.groups.find((g) => g.id === groupId)
    if (!group) {
      group = groupId === DEFAULT_GROUP_ID
        ? this.createDefaultGroup()
        : { id: groupId, name: '未命名分组', items: [], createdAt: Date.now() }
      this.layout.groups.push(group)
    }
    return group
  }

  private createDefaultGroup(): SuperPanelGroup {
    return {
      id: DEFAULT_GROUP_ID,
      name: DEFAULT_GROUP_NAME,
      items: [],
      createdAt: Date.now()
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

  private normalizeLayout(input: unknown): SuperPanelLayout {
    if (!input || typeof input !== 'object') {
      return { version: 2, groups: [this.createDefaultGroup()] }
    }
    const layout = input as Partial<SuperPanelLayout>
    const groups = Array.isArray(layout.groups)
      ? layout.groups.map((g) => this.normalizeGroup(g)).filter(Boolean) as SuperPanelGroup[]
      : []
    // 确保默认分组存在
    if (!groups.some((g) => g.id === DEFAULT_GROUP_ID)) {
      groups.unshift(this.createDefaultGroup())
    }
    return { version: 2, groups }
  }

  private normalizeGroup(input: unknown): SuperPanelGroup | null {
    if (!input || typeof input !== 'object') return null
    const g = input as Partial<SuperPanelGroup>
    if (!g.id || !g.name) return null
    return {
      id: g.id,
      name: g.name,
      boundApp: g.boundApp || undefined,
      items: this.normalizePinnedItems(g.items),
      createdAt: typeof g.createdAt === 'number' ? g.createdAt : Date.now()
    }
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
