/**
 * Hot-start budget & frecency helpers (P1 + P3)
 *
 * 把"缓存几个插件/进程池多大/预热几个"等热启动预算从写死常量改为按机器内存
 * 自适应；并提供启动时按 frecency 选取常用插件的纯函数，便于单测。
 */

export interface HotStartBudget {
  /** Resident-UI 秒开缓存上限（隐藏保活已渲染面板的数量） */
  residentUiCacheLimit: number
  /** 搜索预热（仅 initPlugin，不跑 onLoad）缓存上限 */
  prewarmCacheLimit: number
  /** 通用 Host 进程池大小（预 fork 待命的 worker 数） */
  hostPoolSize: number
  /** 默认 profile 的空白 WebContentsView 外壳池大小 */
  pluginViewPoolSize: number
  /** 启动后按 frecency 预热的常用插件数量 */
  startupPrewarmCount: number
}

const GiB = 1024 * 1024 * 1024

/**
 * 依据总内存给出热启动预算。中档（8–16GB）保持与历史写死值一致
 * （resident 6 / prewarm 3 / pool 3），避免在典型机器上改变既有行为。
 */
export function computeHotStartBudget(totalMemoryBytes: number): HotStartBudget {
  const gb = totalMemoryBytes / GiB

  if (!Number.isFinite(gb) || gb <= 0 || gb < 8) {
    // 低配 / 取不到内存时走保守档，降低内存压力。
    return {
      residentUiCacheLimit: 4,
      prewarmCacheLimit: 2,
      hostPoolSize: 2,
      pluginViewPoolSize: 1,
      startupPrewarmCount: 2
    }
  }

  if (gb < 16) {
    // 中档：与历史默认完全一致。
    return {
      residentUiCacheLimit: 6,
      prewarmCacheLimit: 3,
      hostPoolSize: 3,
      pluginViewPoolSize: 2,
      startupPrewarmCount: 3
    }
  }

  if (gb < 32) {
    return {
      residentUiCacheLimit: 10,
      prewarmCacheLimit: 4,
      hostPoolSize: 4,
      pluginViewPoolSize: 3,
      startupPrewarmCount: 4
    }
  }

  return {
    residentUiCacheLimit: 14,
    prewarmCacheLimit: 5,
    hostPoolSize: 5,
    pluginViewPoolSize: 4,
    startupPrewarmCount: 5
  }
}

/**
 * Frecency = 使用频次 × 时间衰减。与渲染进程 PluginList 的口径保持一致，
 * 保证"最近高频"判断在主/渲染两侧一致。
 */
export function computeFrecency(lastUsedAt: number, useCount: number, now: number = Date.now()): number {
  const ageDays = (now - lastUsedAt) / 86_400_000
  let decay: number
  if (ageDays < 1) decay = 1.0
  else if (ageDays < 7) decay = 0.9
  else if (ageDays < 14) decay = 0.7
  else if (ageDays < 31) decay = 0.5
  else if (ageDays < 90) decay = 0.25
  else decay = 0.1
  return Math.max(0, useCount) * decay
}

export interface RecentUsageEntry {
  pluginId: string
  lastUsedAt: number
  useCount: number
}

/**
 * 从最近使用记录中按 frecency 选出 Top-N 个**去重后的** pluginId。
 * 同一插件的多个 feature 取其最高 frecency 作为该插件的得分。
 */
export function pickStartupPrewarmTargets(
  entries: RecentUsageEntry[],
  limit: number,
  now: number = Date.now()
): string[] {
  if (limit <= 0) return []

  const scoreByPlugin = new Map<string, number>()
  for (const entry of entries) {
    if (!entry?.pluginId) continue
    const score = computeFrecency(entry.lastUsedAt, entry.useCount, now)
    const prev = scoreByPlugin.get(entry.pluginId)
    if (prev === undefined || score > prev) {
      scoreByPlugin.set(entry.pluginId, score)
    }
  }

  return Array.from(scoreByPlugin.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([pluginId]) => pluginId)
}
