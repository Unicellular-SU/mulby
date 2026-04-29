import type {
  PluginStorePlugin,
  PluginStoreEntry,
  PluginStoreInstallStatus
} from '../../shared/types/plugin-store'

export function getStorePluginDisplayName(plugin: PluginStorePlugin): string {
  return plugin.displayName || plugin.name
}

export function getStorePluginInitial(plugin: PluginStorePlugin): string {
  const text = getStorePluginDisplayName(plugin).trim()
  if (!text) return '?'
  return text.slice(0, 1).toUpperCase()
}

export function getStoreTransportMeta(url: string): {
  label: string
  allowInstall: boolean
  className: string
} {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') {
      return {
        label: 'HTTPS',
        allowInstall: true,
        className:
          'border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
      }
    }
    const hostname = parsed.hostname.toLowerCase()
    if (
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
    ) {
      return {
        label: 'Local HTTP',
        allowInstall: true,
        className:
          'border-blue-200 text-blue-700 dark:border-blue-500/30 dark:text-blue-300'
      }
    }
    return {
      label: 'Need HTTPS',
      allowInstall: false,
      className:
        'border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-300'
    }
  } catch {
    return {
      label: 'Invalid URL',
      allowInstall: false,
      className:
        'border-red-200 text-red-700 dark:border-red-500/30 dark:text-red-300'
    }
  }
}

export function getStoreStatusMeta(status: PluginStoreInstallStatus): {
  label: string
  className: string
} {
  switch (status) {
    case 'updatable':
      return {
        label: '可更新',
        className:
          'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
      }
    case 'installed':
      return {
        label: '已安装',
        className:
          'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
      }
    case 'not-installed':
      return {
        label: '未安装',
        className:
          'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
      }
  }
}

export function getStoreIntegrityMeta(entry: PluginStoreEntry): {
  label: string
  className: string
} {
  if (entry.plugin.sha256) {
    return {
      label: 'SHA256',
      className:
        'border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
    }
  }
  return {
    label: 'No checksum',
    className:
      'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'
  }
}

export function formatStorePackageTime(timestamp?: string): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export function formatStoreSyncTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '未同步'
  return new Date(timestamp).toLocaleString()
}

export function buildStoreSearchText(plugin: PluginStorePlugin): string {
  return [
    plugin.id,
    plugin.name,
    plugin.displayName,
    plugin.description,
    plugin.author,
    plugin.publisher,
    ...(plugin.tags || []),
    ...(plugin.categories || [])
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

export type StoreSortKey = 'default' | 'name' | 'updated' | 'installed-first'

export function sortStoreEntries(
  entries: PluginStoreEntry[],
  sortKey: StoreSortKey
): PluginStoreEntry[] {
  if (sortKey === 'default') return entries
  const sorted = [...entries]
  switch (sortKey) {
    case 'name':
      sorted.sort((a, b) =>
        getStorePluginDisplayName(a.plugin).localeCompare(
          getStorePluginDisplayName(b.plugin)
        )
      )
      break
    case 'updated':
      sorted.sort((a, b) => {
        const ta = a.plugin.lastPackageTime || ''
        const tb = b.plugin.lastPackageTime || ''
        return tb.localeCompare(ta)
      })
      break
    case 'installed-first':
      sorted.sort((a, b) => {
        const order: Record<string, number> = {
          updatable: 0,
          installed: 1,
          'not-installed': 2
        }
        return (order[a.installState.status] ?? 2) - (order[b.installState.status] ?? 2)
      })
      break
  }
  return sorted
}

export const PLUGIN_TYPE_LABELS: Record<string, string> = {
  utility: '实用工具',
  productivity: '效率工具',
  developer: '开发者工具',
  system: '系统工具',
  media: '媒体工具',
  network: '网络工具',
  ai: 'AI 工具',
  entertainment: '休闲娱乐',
  other: '其他'
}

export function getPluginTypeLabel(type: string): string {
  return PLUGIN_TYPE_LABELS[type] || type
}

export function collectStoreCategories(entries: PluginStoreEntry[]): string[] {
  const set = new Set<string>()
  for (const entry of entries) {
    if (entry.plugin.type) set.add(entry.plugin.type)
  }
  return Array.from(set).sort()
}

export const STORE_BUTTON_GHOST =
  'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 text-xs leading-none text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 no-drag'

export const STORE_BUTTON_PRIMARY =
  'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 text-xs leading-none text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 no-drag'

export const STORE_BUTTON_EMPHASIS =
  'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-slate-900 bg-slate-900 px-3 text-xs leading-none text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 no-drag'

export const STORE_CARD_CLASS =
  'rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900'

export const STORE_SECTION_TITLE =
  'mb-3 text-sm font-semibold text-slate-900 dark:text-white'
