import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { PluginStateConfig, RecentPluginUsageEntry } from '../../shared/types/plugin'

interface PluginStateFile {
  plugins: PluginStateConfig
  recentUsage: RecentPluginUsageEntry[]
}

const MAX_RECENT_USAGE = 50

export class PluginStateManager {
  private configPath: string
  private pluginStates: PluginStateConfig = {}
  private recentUsage: RecentPluginUsageEntry[] = []

  constructor() {
    const configDir = app.getPath('userData')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.configPath = join(configDir, 'plugin-state.json')
    this.load()
  }

  // 加载状态配置
  private load(): void {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8')
        const parsed = JSON.parse(content) as PluginStateConfig | Partial<PluginStateFile>

        // 兼容旧版本格式：根对象直接是插件状态 map
        if (parsed && typeof parsed === 'object' && 'plugins' in parsed) {
          this.pluginStates = this.normalizePluginStates(parsed.plugins)
          this.recentUsage = this.normalizeRecentUsage(parsed.recentUsage)
          return
        }

        this.pluginStates = this.normalizePluginStates(parsed as PluginStateConfig)
        this.recentUsage = []
      } catch {
        this.pluginStates = {}
        this.recentUsage = []
      }
    }
  }

  // 保存状态配置
  private save(): void {
    const data: PluginStateFile = {
      plugins: this.pluginStates,
      recentUsage: this.recentUsage
    }
    writeFileSync(this.configPath, JSON.stringify(data, null, 2))
  }

  // 获取插件状态
  getPluginState(name: string): { enabled: boolean; installedAt?: number; updatedAt?: number; backgroundRunning?: boolean; backgroundStartedAt?: number; backgroundRestartCount?: number } {
    return this.pluginStates[name] || { enabled: true }
  }

  // 设置插件启用状态
  setEnabled(name: string, enabled: boolean): void {
    if (!this.pluginStates[name]) {
      this.pluginStates[name] = { enabled, installedAt: Date.now() }
    } else {
      this.pluginStates[name].enabled = enabled
    }
    this.save()
  }

  // 记录插件安装
  recordInstall(name: string): void {
    this.pluginStates[name] = {
      enabled: true,
      installedAt: Date.now()
    }
    this.save()
  }

  // 记录插件更新
  recordUpdate(name: string): void {
    if (this.pluginStates[name]) {
      this.pluginStates[name].updatedAt = Date.now()
    } else {
      this.pluginStates[name] = { enabled: true, installedAt: Date.now(), updatedAt: Date.now() }
    }
    this.save()
  }

  // 删除插件状态
  removePluginState(name: string): void {
    delete this.pluginStates[name]
    this.recentUsage = this.recentUsage.filter((item) => item.pluginId !== name)
    this.save()
  }

  // 获取所有状态
  getAllStates(): PluginStateConfig {
    return { ...this.pluginStates }
  }

  // 设置后台运行状态
  setBackgroundRunning(name: string, running: boolean): void {
    if (!this.pluginStates[name]) {
      this.pluginStates[name] = { enabled: true }
    }
    this.pluginStates[name].backgroundRunning = running
    if (running) {
      this.pluginStates[name].backgroundStartedAt = Date.now()
    }
    this.save()
  }

  // 更新后台重启计数
  updateBackgroundRestartCount(name: string, count: number): void {
    if (!this.pluginStates[name]) {
      this.pluginStates[name] = { enabled: true }
    }
    this.pluginStates[name].backgroundRestartCount = count
    this.save()
  }

  // 重置后台重启计数
  resetBackgroundRestartCount(name: string): void {
    if (this.pluginStates[name]) {
      this.pluginStates[name].backgroundRestartCount = 0
      this.save()
    }
  }

  // 记录最近使用
  recordRecentUsage(pluginId: string, featureCode: string): void {
    const now = Date.now()
    const index = this.recentUsage.findIndex(
      (item) => item.pluginId === pluginId && item.featureCode === featureCode
    )

    if (index >= 0) {
      const current = this.recentUsage[index]
      this.recentUsage[index] = {
        ...current,
        lastUsedAt: now,
        useCount: current.useCount + 1
      }
    } else {
      this.recentUsage.push({
        pluginId,
        featureCode,
        lastUsedAt: now,
        useCount: 1
      })
    }

    this.recentUsage.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    if (this.recentUsage.length > MAX_RECENT_USAGE) {
      this.recentUsage = this.recentUsage.slice(0, MAX_RECENT_USAGE)
    }
    this.save()
  }

  // 获取最近使用
  getRecentUsage(limit: number = 20): RecentPluginUsageEntry[] {
    if (limit <= 0) return []
    return this.recentUsage
      .slice()
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, limit)
  }

  private normalizePluginStates(input: unknown): PluginStateConfig {
    if (!input || typeof input !== 'object') {
      return {}
    }

    const result: PluginStateConfig = {}
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const state = value as {
        enabled?: boolean
        installedAt?: number
        updatedAt?: number
        backgroundRunning?: boolean
        backgroundStartedAt?: number
        backgroundRestartCount?: number
      }
      result[key] = {
        enabled: state.enabled !== false,
        installedAt: typeof state.installedAt === 'number' ? state.installedAt : undefined,
        updatedAt: typeof state.updatedAt === 'number' ? state.updatedAt : undefined,
        backgroundRunning: typeof state.backgroundRunning === 'boolean' ? state.backgroundRunning : undefined,
        backgroundStartedAt: typeof state.backgroundStartedAt === 'number' ? state.backgroundStartedAt : undefined,
        backgroundRestartCount: typeof state.backgroundRestartCount === 'number' ? state.backgroundRestartCount : undefined
      }
    }
    return result
  }

  private normalizeRecentUsage(input: unknown): RecentPluginUsageEntry[] {
    if (!Array.isArray(input)) return []
    const items: RecentPluginUsageEntry[] = []
    for (const entry of input) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as Partial<RecentPluginUsageEntry>
      if (!candidate.pluginId || !candidate.featureCode) continue
      items.push({
        pluginId: candidate.pluginId,
        featureCode: candidate.featureCode,
        lastUsedAt: typeof candidate.lastUsedAt === 'number' ? candidate.lastUsedAt : Date.now(),
        useCount: typeof candidate.useCount === 'number' ? candidate.useCount : 1
      })
    }
    items.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    return items.slice(0, MAX_RECENT_USAGE)
  }
}
