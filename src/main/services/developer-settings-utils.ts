import path from 'node:path'
import type {
  DeveloperSettings,
  PluginProjectEntry,
  PluginProjectSource
} from '../../shared/types/settings'
import { dedupeProjects } from '../plugin/plugin-project-utils'

/**
 * 开发者设置默认值（纯数据，无 db 依赖，供 DEFAULT_SETTINGS 与单测复用）。
 */
export const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = {
  enabled: false,
  pluginPaths: [],
  pluginProjects: [],
  autoReload: true,
  showDevTools: false,
  logLevel: 'info'
}

function normalizeStringList(input: unknown, maxItems = 200): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const value = String(item || '').trim()
    if (!value) continue
    const lower = value.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(value)
    if (out.length >= maxItems) break
  }
  return out
}

const VALID_SOURCES: PluginProjectSource[] = ['added', 'imported', 'created', 'migrated']

/**
 * 归一化开发者设置：默认值合并、legacy pluginPaths → pluginProjects 迁移、每项归一化与去重。
 * 纯函数（不触碰 db），便于单测。
 */
export function normalizeDeveloperSettings(
  input: Partial<DeveloperSettings> | undefined
): DeveloperSettings {
  const d = { ...DEFAULT_DEVELOPER_SETTINGS, ...(input || {}) }
  const pluginPaths = normalizeStringList(d.pluginPaths, 200)
  let pluginProjects = Array.isArray(d.pluginProjects) ? d.pluginProjects : []

  // 迁移：存在 legacy pluginPaths 且尚无 projects 时，把每个目录迁移为 collection/migrated 项目
  if (pluginProjects.length === 0 && pluginPaths.length > 0) {
    pluginProjects = pluginPaths.map((p, i) => ({
      id: `proj-mig-${i}-${Date.now()}`,
      path: path.resolve(p),
      type: 'collection' as const,
      source: 'migrated' as const,
      createdAt: Date.now()
    }))
  }

  // 归一化每项 + 去重（按 resolve 路径）
  const normalized: PluginProjectEntry[] = pluginProjects
    .filter(
      (p): p is PluginProjectEntry =>
        !!p && typeof p.path === 'string' && p.path.trim().length > 0
    )
    .map((p, i) => ({
      id: String(p.id || `proj-${i}-${Date.now()}`),
      path: path.resolve(p.path),
      type: p.type === 'single' ? ('single' as const) : ('collection' as const),
      source: VALID_SOURCES.includes(p.source as PluginProjectSource)
        ? (p.source as PluginProjectSource)
        : 'added',
      label: typeof p.label === 'string' ? p.label : undefined,
      createdAt: Number(p.createdAt) > 0 ? Number(p.createdAt) : Date.now(),
      lastOpenedAt:
        p.lastOpenedAt && Number(p.lastOpenedAt) > 0 ? Number(p.lastOpenedAt) : undefined
    }))

  return {
    enabled: d.enabled === true,
    pluginPaths,
    pluginProjects: dedupeProjects(normalized),
    autoReload: d.autoReload !== false,
    showDevTools: d.showDevTools === true,
    logLevel: d.logLevel || 'info'
  }
}
