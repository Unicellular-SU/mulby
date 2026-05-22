import type { SystemIconKind, SystemIconRequest } from '../../shared/types/electron'

export type SystemFileIconCategory =
  | 'folder'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'code'
  | 'text'
  | 'file'

export interface SystemIconBatchAppItem {
  path: string
  iconPath?: string
}

export interface SystemIconBatchFileItem {
  name?: string
  path: string
  isDirectory?: boolean
}

export interface SystemFileIconItem {
  name?: string
  path: string
  isDirectory: boolean
}

export interface BuildSystemIconBatchInput {
  appItems: SystemIconBatchAppItem[]
  fileItems: SystemIconBatchFileItem[]
  iconCache: { has(key: string): boolean }
  pendingKeys: { has(key: string): boolean }
}

export interface BuildSystemIconBatchResult {
  neededKeys: string[]
  requests: SystemIconRequest[]
}

export function getSystemIconCacheKey(kind: SystemIconKind, path: string): string {
  return `${kind}:${path}`
}

const FILE_ICON_EXTENSIONS: Record<Exclude<SystemFileIconCategory, 'folder' | 'file'>, Set<string>> = {
  pdf: new Set(['.pdf']),
  document: new Set(['.doc', '.docx', '.rtf', '.odt', '.pages']),
  spreadsheet: new Set(['.xls', '.xlsx', '.csv', '.ods', '.numbers']),
  presentation: new Set(['.ppt', '.pptx', '.odp', '.key']),
  image: new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.heic', '.svg', '.ico', '.icns']),
  audio: new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.wma', '.amr']),
  video: new Set(['.mp4', '.mkv', '.mov', '.avi', '.wmv', '.webm', '.m4v', '.flv']),
  archive: new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz', '.iso']),
  code: new Set([
    '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.less', '.vue', '.svelte',
    '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.swift',
    '.kt', '.sh', '.ps1', '.bat', '.cmd', '.xml', '.yaml', '.yml', '.toml', '.sql'
  ]),
  text: new Set(['.txt', '.md', '.markdown', '.log', '.ini', '.conf'])
}

const FILE_ICON_SVG_BY_CATEGORY: Record<SystemFileIconCategory, string> = {
  folder: iconSvg('folder', '#F59E0B', '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M3 10h18"/>'),
  pdf: fileSvg('pdf', '#EF4444', '<path d="M8 17v-4h1.5a1.25 1.25 0 0 1 0 2.5H8"/><path d="M12 17v-4h1a2 2 0 0 1 0 4z"/><path d="M16 17v-4h2"/><path d="M16 15h1.5"/>'),
  document: fileSvg('document', '#3B82F6', '<path d="M8 13h8"/><path d="M8 16h8"/><path d="M8 19h5"/>'),
  spreadsheet: fileSvg('spreadsheet', '#22C55E', '<path d="M8 13h8"/><path d="M8 16h8"/><path d="M8 19h8"/><path d="M11 13v6"/><path d="M14 13v6"/>'),
  presentation: fileSvg('presentation', '#F97316', '<path d="M8 13h8v5H8z"/><path d="M10 21l2-3 2 3"/>'),
  image: fileSvg('image', '#A855F7', '<circle cx="9.5" cy="13.5" r="1.2"/><path d="M8 19l3.2-3.2 1.8 1.8 1.5-1.5L18 19"/>'),
  audio: fileSvg('audio', '#EC4899', '<path d="M10 18V9l6-1v8"/><circle cx="8.5" cy="18" r="1.5"/><circle cx="14.5" cy="16" r="1.5"/>'),
  video: fileSvg('video', '#6366F1', '<path d="M8 13h6a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H8z"/><path d="M16 15l3-2v6l-3-2"/>'),
  archive: fileSvg('archive', '#A16207', '<path d="M9 13h6"/><path d="M9 16h6"/><path d="M10 19h4"/><path d="M12 6v5"/>'),
  code: fileSvg('code', '#06B6D4', '<path d="M10 14l-2 2 2 2"/><path d="M14 14l2 2-2 2"/><path d="M13 13l-2 6"/>'),
  text: fileSvg('text', '#64748B', '<path d="M8 13h8"/><path d="M8 16h8"/><path d="M8 19h6"/>'),
  file: fileSvg('file', '#64748B', '<path d="M9 14h6"/><path d="M9 17h4"/>')
}

function iconSvg(category: SystemFileIconCategory, accent: string, body: string): string {
  return `
<svg data-file-icon="${category}" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  ${body}
</svg>
`.trim()
}

function fileSvg(category: SystemFileIconCategory, accent: string, body: string): string {
  return iconSvg(category, accent, `
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <path d="M14 2v6h6"/>
  ${body}
`)
}

function getLowercaseExtension(item: Pick<SystemFileIconItem, 'name' | 'path'>): string {
  const source = item.name || item.path
  const slashIndex = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'))
  const filename = source.slice(slashIndex + 1)
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === filename.length - 1) return ''
  return filename.slice(dotIndex).toLowerCase()
}

export function resolveSystemFileIconCategory(item: SystemFileIconItem): SystemFileIconCategory {
  if (item.isDirectory) return 'folder'
  const extension = getLowercaseExtension(item)
  for (const [category, extensions] of Object.entries(FILE_ICON_EXTENSIONS)) {
    if (extensions.has(extension)) return category as SystemFileIconCategory
  }
  return 'file'
}

export function getSystemFileIconSvg(item: SystemFileIconItem): string {
  return FILE_ICON_SVG_BY_CATEGORY[resolveSystemFileIconCategory(item)]
}

export function buildSystemIconBatch({
  appItems,
  fileItems,
  iconCache,
  pendingKeys
}: BuildSystemIconBatchInput): BuildSystemIconBatchResult {
  const neededKeys: string[] = []
  const requests: SystemIconRequest[] = []

  for (const item of appItems) {
    const key = getSystemIconCacheKey('app', item.path)
    neededKeys.push(key)
    if (!iconCache.has(key) && !pendingKeys.has(key)) {
      requests.push({ key, path: item.iconPath || item.path, kind: item.iconPath ? 'file' : 'app' })
    }
  }

  for (const item of fileItems) {
    neededKeys.push(getSystemIconCacheKey('file', item.path))
  }

  return { neededKeys, requests }
}
