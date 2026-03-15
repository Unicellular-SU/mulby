import { existsSync, statSync } from 'fs'
import { join } from 'path'
import type { Plugin, PluginFeature, PluginIcon } from '../../shared/types/plugin'

export type DevPluginWatchTargetKind = 'code' | 'metadata'

export interface DevPluginWatchTarget {
  filePath: string
  kind: DevPluginWatchTargetKind
}

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

function isRemoteIconPath(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function isInlineSvg(value: string): boolean {
  return value.trimStart().startsWith('<svg')
}

function isEmojiLike(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || /[\\/]/.test(trimmed) || trimmed.includes('.')) {
    return false
  }
  return trimmed.length <= 4 && EMOJI_PATTERN.test(trimmed)
}

export function resolveLocalIconRelativePath(
  icon: PluginIcon | undefined,
  options: { watchDefaultFile?: boolean } = {}
): string | null {
  const watchDefaultFile = options.watchDefaultFile === true

  if (!icon) {
    return watchDefaultFile ? 'icon.png' : null
  }

  if (typeof icon === 'string') {
    if (isRemoteIconPath(icon) || isInlineSvg(icon) || isEmojiLike(icon)) {
      return null
    }
    return icon
  }

  switch (icon.type) {
    case 'file':
      return icon.value || 'icon.png'
    case 'url':
    case 'svg':
    case 'emoji':
    default:
      return null
  }
}

export function collectPluginMetadataWatchFiles(plugin: Pick<Plugin, 'path' | 'manifest'>): string[] {
  const seen = new Set<string>()
  const files: string[] = []

  const addFile = (filePath: string | null) => {
    if (!filePath) return
    const absolutePath = join(plugin.path, filePath)
    if (seen.has(absolutePath)) return
    seen.add(absolutePath)
    files.push(absolutePath)
  }

  addFile('manifest.json')
  addFile(resolveLocalIconRelativePath(plugin.manifest.icon, { watchDefaultFile: true }))

  for (const feature of plugin.manifest.features || []) {
    addFile(resolveLocalIconRelativePath(feature.icon))
  }

  return files
}

export function collectDevPluginWatchTargets(plugin: Plugin): DevPluginWatchTarget[] {
  const seen = new Set<string>()
  const targets: DevPluginWatchTarget[] = []

  const addTarget = (kind: DevPluginWatchTargetKind, filePath: string) => {
    const key = `${kind}:${filePath}`
    if (seen.has(key)) return
    seen.add(key)
    targets.push({ kind, filePath })
  }

  addTarget('code', join(plugin.path, plugin.manifest.main))

  for (const filePath of collectPluginMetadataWatchFiles(plugin)) {
    addTarget('metadata', filePath)
  }

  return targets
}

function getIconFingerprint(icon: PluginIcon | undefined, pluginPath: string): string {
  if (!icon) {
    return 'none'
  }

  const localPath = resolveLocalIconRelativePath(icon)
  if (localPath) {
    const absolutePath = join(pluginPath, localPath)
    if (!existsSync(absolutePath)) {
      return `file:${localPath}:missing`
    }

    try {
      const stats = statSync(absolutePath)
      return `file:${localPath}:${stats.size}:${stats.mtimeMs}`
    } catch {
      return `file:${localPath}:error`
    }
  }

  if (typeof icon === 'string') {
    return `string:${icon}`
  }

  return `object:${JSON.stringify(icon)}`
}

export function buildFeatureIconCacheKey(
  pluginId: string,
  feature: Pick<PluginFeature, 'code' | 'icon'>,
  pluginPath: string
): string {
  return `${pluginId}:${feature.code}:${getIconFingerprint(feature.icon, pluginPath)}`
}
