import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { PluginManifest } from '../../shared/types/plugin'
import type {
  PluginManifestSummary,
  PluginValidationResult
} from '../../shared/types/developer'
import { isSystemPlugin } from './internal-plugins'

/**
 * 检查插件是否兼容当前平台（与 loader.isCompatiblePlatform 同规则，本地实现避免引入额外依赖）。
 */
function isCompatiblePlatform(platform: string | string[] | undefined): boolean {
  if (!platform) return true
  const current = process.platform
  if (Array.isArray(platform)) return platform.includes(current)
  return platform === current
}

/**
 * 解析 main 入口：优先 manifest.main，回退 basename / main.js / index.js。
 * 返回解析到的相对路径，找不到返回 null。
 */
function resolveMainEntry(mainEntry: string, pluginPath: string): string | null {
  const declaredPath = join(pluginPath, mainEntry)
  if (existsSync(declaredPath)) return mainEntry

  const basename = String(mainEntry).split(/[/\\]/).pop()
  const candidates = Array.from(
    new Set([basename, 'main.js', 'index.js'].filter((i): i is string => Boolean(i && i.length > 0)))
  )
  for (const candidate of candidates) {
    if (existsSync(join(pluginPath, candidate))) return candidate
  }
  return null
}

function buildSummary(manifest: PluginManifest): PluginManifestSummary {
  const id = manifest.id || manifest.name
  return {
    id,
    name: manifest.name,
    version: manifest.version,
    displayName: manifest.displayName,
    description: manifest.description,
    main: manifest.main,
    hasUi: typeof manifest.ui === 'string' && manifest.ui.length > 0,
    featureCount: Array.isArray(manifest.features) ? manifest.features.length : 0,
    platform: manifest.platform
  }
}

/**
 * 校验单个插件目录（不落库）。
 * 检查：manifest 存在/可解析、必填字段、平台兼容、main 解析、构建产物。
 */
export function validatePluginAt(pluginPath: string): PluginValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const manifestPath = join(pluginPath, 'manifest.json')
  if (!existsSync(manifestPath)) {
    return {
      valid: false,
      errors: ['未找到 manifest.json（manifest missing）'],
      warnings,
      mainEntryFound: false,
      built: false
    }
  }

  let manifest: PluginManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest
  } catch (err) {
    return {
      valid: false,
      errors: [`manifest.json 解析失败（invalid JSON）：${err instanceof Error ? err.message : String(err)}`],
      warnings,
      mainEntryFound: false,
      built: false
    }
  }

  const pluginId = manifest.id || manifest.name
  const isSystem = isSystemPlugin(pluginId)

  // 必填字段
  const required = isSystem
    ? ['name', 'version', 'displayName', 'features']
    : ['name', 'version', 'displayName', 'main', 'features']
  const manifestRecord = manifest as unknown as Record<string, unknown>
  for (const field of required) {
    if (!(field in manifest) || manifestRecord[field] === undefined) {
      errors.push(`缺少必填字段：${field}`)
    }
  }

  // features 校验
  if (!Array.isArray(manifest.features) || manifest.features.length === 0) {
    errors.push('features 必须为非空数组')
  } else {
    for (const feature of manifest.features) {
      if (!Array.isArray(feature.cmds)) continue
      for (const cmd of feature.cmds) {
        if (cmd.type === 'regex') {
          const raw = cmd as unknown as Record<string, unknown>
          if (!raw.match && typeof raw.value === 'string') {
            warnings.push(`feature "${feature.code}" 的 regex 命令使用了 "value"，应为 "match"`)
          } else if (!raw.match) {
            warnings.push(`feature "${feature.code}" 的 regex 命令缺少 "match" 字段`)
          }
        }
      }
    }
  }

  // 平台兼容
  if (!isCompatiblePlatform(manifest.platform)) {
    const platforms = Array.isArray(manifest.platform)
      ? manifest.platform.join(', ')
      : manifest.platform
    errors.push(`平台不兼容（platform）：仅支持 ${platforms}，当前为 ${process.platform}`)
  }

  // main 解析与构建产物
  let mainEntryFound = false
  let built = false
  if (isSystem) {
    // 系统插件无 main，视为已"构建"
    mainEntryFound = true
    built = true
  } else if (typeof manifest.main === 'string' && manifest.main.length > 0) {
    const resolved = resolveMainEntry(manifest.main, pluginPath)
    mainEntryFound = resolved !== null
    built = existsSync(join(pluginPath, manifest.main))
    if (!mainEntryFound) {
      errors.push(`main 入口未找到（main file not found）：${manifest.main}`)
    }
  }

  const hasRequiredFieldErrors = errors.length > 0
  const valid = !hasRequiredFieldErrors && (isSystem || mainEntryFound)

  return {
    valid,
    errors,
    warnings,
    manifest: buildSummary(manifest),
    mainEntryFound,
    built
  }
}
