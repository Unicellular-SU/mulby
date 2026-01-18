import { extname } from 'path'
import type { InputAttachment, InputPayload, PluginCmd, PluginFeature } from './types/plugin'

export type MatchType = 'keyword' | 'regex' | 'files' | 'img' | 'over'

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
    attachments: Array.isArray(input.attachments) ? input.attachments : []
  }
}

export function matchPriority(type: MatchType): number {
  switch (type) {
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

function getCachedRegex(pattern: string): RegExp | null {
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
  const q = text.toLowerCase()
  const hasText = text.trim().length > 0
  const hasAttachments = input.attachments.length > 0

  let best: FeatureMatch | null = null

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
      if (cmd.value.toLowerCase().includes(q)) {
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

    if (!matchType) continue

    const score = matchPriority(matchType)
    if (!best || score > best.score) {
      best = { matchType, cmd, score }
    }
  }

  return best
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
