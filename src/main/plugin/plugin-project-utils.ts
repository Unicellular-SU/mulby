import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type {
  PluginProjectEntry,
  PluginProjectSource,
  PluginProjectType
} from '../../shared/types/settings'

/**
 * 判断目录是否为"单个插件目录"：目录根部直接含 manifest.json。
 */
export function isSinglePluginDir(dirPath: string): boolean {
  return existsSync(join(dirPath, 'manifest.json'))
}

/**
 * 自动判别开发项目类型：
 * - single：目录根部直接含 manifest.json
 * - collection：父目录，需扫描子目录寻找插件
 */
export function detectProjectType(dirPath: string): PluginProjectType {
  return isSinglePluginDir(dirPath) ? 'single' : 'collection'
}

/**
 * 按 resolve 后的绝对路径去重，保留先到者。返回的项目 path 统一为 resolve 结果。
 */
export function dedupeProjects(projects: PluginProjectEntry[]): PluginProjectEntry[] {
  const seen = new Set<string>()
  const out: PluginProjectEntry[] = []
  for (const p of projects) {
    const key = resolve(p.path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...p, path: key })
  }
  return out
}

const VALID_SOURCES: PluginProjectSource[] = ['added', 'imported', 'created', 'migrated']

export interface BuildProjectEntryResult {
  ok: boolean
  entry?: PluginProjectEntry
  error?: string
}

/**
 * 构造一个新的开发项目 entry（供 Developer IPC `addPluginProject` 复用）。
 * - 校验目录存在；
 * - 与 existing 按 resolve 路径去重，已存在返回冲突；
 * - 自动判别 type（single/collection）。
 */
export function buildProjectEntry(
  dirPath: string,
  source: string | undefined,
  existing: PluginProjectEntry[]
): BuildProjectEntryResult {
  if (!dirPath || typeof dirPath !== 'string' || dirPath.trim().length === 0) {
    return { ok: false, error: '目录路径无效' }
  }
  if (!existsSync(dirPath)) {
    return { ok: false, error: '目录不存在' }
  }
  const resolved = resolve(dirPath)
  if (existing.some((x) => resolve(x.path) === resolved)) {
    return { ok: false, error: '项目已存在' }
  }
  const normalizedSource: PluginProjectSource = VALID_SOURCES.includes(source as PluginProjectSource)
    ? (source as PluginProjectSource)
    : 'added'
  const entry: PluginProjectEntry = {
    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    path: resolved,
    type: detectProjectType(resolved),
    source: normalizedSource,
    createdAt: Date.now()
  }
  return { ok: true, entry }
}
