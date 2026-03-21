import { extname } from 'path'
import { pinyin } from 'pinyin-pro'
import type { ActiveWindowInfo, CommandKind, InputAttachment, InputPayload, PluginCmd, PluginFeature } from './types/plugin'

export type MatchType = 'keyword' | 'regex' | 'files' | 'img' | 'over' | 'window'

export interface FeatureMatch {
  matchType: MatchType
  cmd: PluginCmd
  score: number
}

export function normalizeInputPayload(input?: string | InputPayload): InputPayload {
  if (!input) {
    return { text: '', attachments: [] }
  }
  if (typeof input === 'string') {
    return { text: input, attachments: [] }
  }
  return {
    text: input.text || '',
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    activeWindow: input.activeWindow
  }
}

export function matchPriority(type: MatchType): number {
  switch (type) {
    case 'window':
      return 4
    case 'img':
      return 3
    case 'files':
      return 3
    case 'regex':
      return 2
    case 'over':
      return 1  // 与 keyword 同级
    case 'keyword':
      return 1
  }
}

export function getCommandKind(cmd: PluginCmd): CommandKind {
  if (cmd.type === 'keyword') return 'launch'
  if (cmd.type === 'window') return 'match'
  return 'match'
}

export function isCommandBindable(cmd: PluginCmd): boolean {
  return getCommandKind(cmd) === 'launch'
}

function defaultMatchLabel(prefix: string, featureExplain?: string): string {
  const featureName = featureExplain?.trim() || '未命名功能'
  return `${prefix} · ${featureName}`
}

export function getCommandDisplayLabel(cmd: PluginCmd, featureExplain?: string): string {
  if (cmd.type === 'keyword') {
    return cmd.value.trim() || '未命名指令'
  }
  if (cmd.type === 'regex') {
    return cmd.label?.trim() || cmd.explain?.trim() || defaultMatchLabel('正则匹配', featureExplain)
  }
  if (cmd.type === 'files') {
    return cmd.label?.trim() || defaultMatchLabel('文件匹配', featureExplain)
  }
  if (cmd.type === 'img') {
    return cmd.label?.trim() || defaultMatchLabel('图像匹配', featureExplain)
  }
  if (cmd.type === 'window') {
    return cmd.label?.trim() || defaultMatchLabel('窗口匹配', featureExplain)
  }
  return cmd.label?.trim() || defaultMatchLabel('文本匹配', featureExplain)
}

export function getCommandSignature(cmd: PluginCmd): string {
  if (cmd.type === 'keyword') {
    return `keyword|${cmd.value.trim().toLowerCase()}`
  }
  if (cmd.type === 'regex') {
    return `regex|${cmd.match}|${cmd.minLength ?? ''}|${cmd.maxLength ?? ''}`
  }
  if (cmd.type === 'files') {
    return `files|${(cmd.exts || []).join(',')}|${cmd.fileType || ''}|${cmd.match || ''}|${cmd.minLength ?? ''}|${cmd.maxLength ?? ''}`
  }
  if (cmd.type === 'img') {
    return `img|${(cmd.exts || []).join(',')}`
  }
  if (cmd.type === 'window') {
    return `window|${cmd.app || ''}|${cmd.title || ''}|${cmd.bundleId || ''}`
  }
  return `over|${cmd.exclude || ''}|${cmd.minLength ?? ''}|${cmd.maxLength ?? ''}`
}

function hashCommandSignature(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function getCommandId(cmd: PluginCmd, occurrence: number): string {
  const signature = getCommandSignature(cmd)
  const hash = hashCommandSignature(signature)
  return `${cmd.type}-${hash}-${occurrence}`
}

export function normalizeExt(value: string): string {
  if (!value) return ''
  const trimmed = value.trim().toLowerCase()
  if (trimmed === '*' || trimmed === '.*') return '*'
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

export function getAttachmentExt(attachment: InputAttachment): string {
  if (attachment.ext) return normalizeExt(attachment.ext)
  if (attachment.path) return normalizeExt(extname(attachment.path))
  if (attachment.name) return normalizeExt(extname(attachment.name))
  return ''
}

// 检查附件是否为目录（基于 kind 或路径判断）
export function isDirectoryAttachment(attachment: InputAttachment): boolean {
  // 通过 kind 判断
  if (attachment.kind === 'file' && attachment.path) {
    // 如果路径以斜杠结尾或没有扩展名，可能是目录
    // 实际判断需要从主进程获取，这里基于已有信息推断
    const hasExt = attachment.ext || extname(attachment.path || attachment.name || '')
    if (!hasExt && !attachment.mime) return true
  }
  return false
}

export interface CmdFilesMatch {
  exts?: string[]
  fileType?: 'file' | 'directory' | 'any'
  match?: string
  minLength?: number
  maxLength?: number
}

// Regex Cache
const regexCache = new Map<string, RegExp>()
const MAX_CACHE_SIZE = 1000
const keywordCache = new Map<string, KeywordSearchIndex>()
const MAX_KEYWORD_CACHE_SIZE = 3000

const SEARCH_SEPARATOR_REGEX = /[\s\-_./\\|,:;，。！？、：；'"`‘’“”()（）[\]【】{}<>《》+*&^%$#@!~]+/g
const CAMEL_CASE_BOUNDARY_REGEX = /([a-z0-9])([A-Z])/g
const NON_ALNUM_REGEX = /[^a-z0-9]+/g

export interface KeywordSearchIndex {
  normalized: string
  compact: string
  latinInitials: string
  pinyinFull: string
  pinyinInitials: string
}

function getCachedRegex(pattern: string): RegExp | null {
  // 防御：undefined/null/空字符串 → 拒绝，避免 new RegExp(undefined) 生成匹配一切的 /(?:)/
  if (!pattern) return null

  if (regexCache.has(pattern)) {
    return regexCache.get(pattern)!
  }

  try {
    const regex = new RegExp(pattern)
    if (regexCache.size >= MAX_CACHE_SIZE) {
      // Simple LRU: delete first key
      const firstKey = regexCache.keys().next().value
      if (firstKey) regexCache.delete(firstKey)
    }
    regexCache.set(pattern, regex)
    return regex
  } catch {
    return null
  }
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().normalize('NFKC')
}

export function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(SEARCH_SEPARATOR_REGEX, '')
}

function buildLatinInitials(value: string): string {
  const tokens = value
    .replace(CAMEL_CASE_BOUNDARY_REGEX, '$1 $2')
    .toLowerCase()
    .split(NON_ALNUM_REGEX)
    .filter(Boolean)
  return tokens.map((token) => token[0]).join('')
}

function buildPinyinValue(value: string, pattern: 'pinyin' | 'first'): string {
  try {
    const converted = pinyin(value, {
      type: 'array',
      pattern,
      toneType: 'none',
      nonZh: 'consecutive',
      v: true
    })
    return compactSearchText(converted.join(''))
  } catch {
    return ''
  }
}

export function getCachedKeywordIndex(value: string): KeywordSearchIndex {
  const cached = keywordCache.get(value)
  if (cached) return cached

  const index: KeywordSearchIndex = {
    normalized: normalizeSearchText(value),
    compact: compactSearchText(value),
    latinInitials: compactSearchText(buildLatinInitials(value)),
    pinyinFull: buildPinyinValue(value, 'pinyin'),
    pinyinInitials: buildPinyinValue(value, 'first')
  }

  if (keywordCache.size >= MAX_KEYWORD_CACHE_SIZE) {
    const firstKey = keywordCache.keys().next().value as string | undefined
    if (firstKey) keywordCache.delete(firstKey)
  }
  keywordCache.set(value, index)
  return index
}

export function isSubsequenceMatch(target: string, query: string): boolean {
  if (!target || !query || query.length > target.length) return false
  let targetIndex = 0
  for (const queryChar of query) {
    targetIndex = target.indexOf(queryChar, targetIndex)
    if (targetIndex === -1) return false
    targetIndex += 1
  }
  return true
}

function matchesKeywordQuery(keywordValue: string, normalizedQuery: string, queryCompact: string): boolean {
  if (!normalizedQuery) return false

  const index = getCachedKeywordIndex(keywordValue)

  // 直接包含：保留原有行为（中英文连续匹配）
  if (index.normalized.includes(normalizedQuery)) return true
  if (queryCompact && index.compact.includes(queryCompact)) return true

  // 单字符不启用拼音/跨字，避免噪音匹配
  if (queryCompact.length < 2) return false

  // 拼音缩写 / 跨词英文首字母
  if (index.latinInitials && index.latinInitials.includes(queryCompact)) return true
  if (index.pinyinInitials && index.pinyinInitials.includes(queryCompact)) return true

  // 拼音全拼连续匹配
  if (index.pinyinFull && index.pinyinFull.includes(queryCompact)) return true

  // 跨字匹配（子序列）：例如“百网”匹配“百度网盘”
  if (isSubsequenceMatch(index.compact, queryCompact)) return true
  if (index.pinyinInitials && isSubsequenceMatch(index.pinyinInitials, queryCompact)) return true

  return false
}

export function matchesFiles(cmd: CmdFilesMatch, attachments: InputAttachment[]): boolean {
  const { exts, fileType = 'any', match, minLength, maxLength } = cmd

  // 过滤符合 fileType 的附件
  let filtered = attachments
  if (fileType === 'file') {
    filtered = attachments.filter((a) => !isDirectoryAttachment(a))
  } else if (fileType === 'directory') {
    filtered = attachments.filter((a) => isDirectoryAttachment(a))
  }

  if (filtered.length === 0) return false

  // 检查数量限制
  if (minLength !== undefined && filtered.length < minLength) return false
  if (maxLength !== undefined && filtered.length > maxLength) return false

  // 如果指定了 match 正则，使用正则匹配文件名
  if (match) {
    const regex = getCachedRegex(match)
    if (regex) {
      const hasMatch = filtered.some((a) => {
        const name = a.name || ''
        return regex.test(name)
      })
      if (!hasMatch) return false
    }
  }

  // 如果指定了扩展名，检查扩展名
  if (exts && exts.length > 0) {
    const normalizedExts = exts.map(normalizeExt)
    const hasWildcard = normalizedExts.includes('*')
    if (!hasWildcard) {
      const hasExtMatch = filtered.some((attachment) => {
        const ext = getAttachmentExt(attachment)
        if (!ext) return false
        return normalizedExts.includes(ext)
      })
      if (!hasExtMatch) return false
    }
  }

  return true
}

export function matchesImageExts(exts: string[] | undefined, attachments: InputAttachment[]): boolean {
  const imageAttachments = attachments.filter((attachment) => isImageAttachment(attachment))
  if (!exts || exts.length === 0) return imageAttachments.length > 0
  return matchesFiles({ exts }, imageAttachments)
}

export function isImageAttachment(attachment: InputAttachment): boolean {
  if (attachment.kind === 'image') return true
  if (attachment.mime?.toLowerCase().startsWith('image/')) return true
  const ext = getAttachmentExt(attachment)
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.tif', '.heic', '.heif'].includes(ext)
}

export function findBestMatch(feature: PluginFeature, input: InputPayload): FeatureMatch | null {
  const text = input.text
  const hasText = text.trim().length > 0
  const hasAttachments = input.attachments.length > 0

  // 方案B: 预计算查询文本的 normalize/compact，避免每个 cmd 重复计算
  const normalizedQuery = hasText ? normalizeSearchText(text) : ''
  const queryCompact = hasText ? compactSearchText(normalizedQuery) : ''

  let best: FeatureMatch | null = null
  const maxScore = 4 // window 类型是最高优先级

  for (const cmd of feature.cmds) {
    let matchType: MatchType | null = null

    if (cmd.type === 'regex') {
      if (!hasText) continue
      // 检查长度限制
      if (cmd.minLength !== undefined && text.length < cmd.minLength) continue
      if (cmd.maxLength !== undefined && text.length > cmd.maxLength) continue

      const regex = getCachedRegex(cmd.match)
      if (regex && regex.test(text)) {
        matchType = 'regex'
      }
    }

    if (cmd.type === 'keyword') {
      if (!hasText) continue
      if (matchesKeywordQuery(cmd.value, normalizedQuery, queryCompact)) {
        matchType = 'keyword'
      }
    }

    if (cmd.type === 'files') {
      if (!hasAttachments) continue
      if (matchesFiles(cmd, input.attachments)) {
        matchType = 'files'
      }
    }

    if (cmd.type === 'img') {
      if (!hasAttachments) continue
      if (matchesImageExts(cmd.exts, input.attachments)) {
        matchType = 'img'
      }
    }

    if (cmd.type === 'over') {
      if (!hasText) continue
      // 检查长度限制
      const min = cmd.minLength ?? 0
      const max = cmd.maxLength ?? 10000
      if (text.length < min || text.length > max) continue
      // 检查排除规则
      if (cmd.exclude) {
        const excludeRegex = getCachedRegex(cmd.exclude)
        if (excludeRegex && excludeRegex.test(text)) continue
      }
      matchType = 'over'
    }

    if (cmd.type === 'window') {
      if (!input.activeWindow) continue
      if (matchesWindow(cmd, input.activeWindow)) {
        matchType = 'window'
      }
    }

    if (!matchType) continue

    const score = matchPriority(matchType)
    if (!best || score > best.score) {
      best = { matchType, cmd, score }
      // 方案C: 已达最高优先级，无需继续遍历
      if (score >= maxScore) break
    }
  }

  return best
}

/**
 * 解析匹配模式字符串：
 * - "/pattern/" 格式 → 正则表达式（忽略大小写）
 * - 普通字符串 → 精确匹配（忽略大小写）
 */
function parseMatchPattern(pattern: string): RegExp | null {
  if (!pattern) return null

  // 正则格式: /pattern/ 或 /pattern/flags
  const regexMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/)
  if (regexMatch) {
    try {
      const flags = regexMatch[2].includes('i') ? regexMatch[2] : regexMatch[2] + 'i'
      return new RegExp(regexMatch[1], flags)
    } catch {
      return null
    }
  }

  // 普通字符串：转义后精确匹配（忽略大小写）
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * 检查 CmdWindow 是否匹配当前活跃窗口
 */
export function matchesWindow(
  cmd: { app?: string; title?: string; bundleId?: string },
  activeWindow: ActiveWindowInfo
): boolean {
  const { app, title, bundleId } = activeWindow

  // bundleId 精确匹配（大小写不敏感）
  if (cmd.bundleId) {
    if (cmd.bundleId.toLowerCase() !== (bundleId || '').toLowerCase()) {
      return false
    }
  }

  // app 模式匹配
  if (cmd.app) {
    const regex = parseMatchPattern(cmd.app)
    if (!regex || !regex.test(app)) {
      return false
    }
  }

  // title 模式匹配
  if (cmd.title) {
    const regex = parseMatchPattern(cmd.title)
    if (!regex || !regex.test(title)) {
      return false
    }
  }

  // 至少需要声明一个匹配条件
  if (!cmd.bundleId && !cmd.app && !cmd.title) {
    return false
  }

  return true
}

export function filterAttachmentsByCmd(attachments: InputAttachment[], cmd?: PluginCmd): InputAttachment[] {
  if (!cmd) return attachments
  if (cmd.type !== 'files' && cmd.type !== 'img') return attachments
  if (!cmd.exts || cmd.exts.length === 0) return attachments

  const normalizedExts = cmd.exts.map(normalizeExt)
  if (normalizedExts.includes('*')) return attachments

  return attachments.filter((attachment) => {
    const ext = getAttachmentExt(attachment)
    if (!ext) return false
    return normalizedExts.includes(ext)
  })
}
