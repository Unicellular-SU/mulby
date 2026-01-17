import { extname } from 'path'
import type { InputAttachment, InputPayload, PluginCmd, PluginFeature } from './types/plugin'

export type MatchType = 'keyword' | 'regex' | 'files' | 'img'

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

export function matchesFiles(exts: string[], attachments: InputAttachment[]): boolean {
  const normalizedExts = exts.map(normalizeExt)
  const hasWildcard = normalizedExts.includes('*')
  if (hasWildcard) return attachments.length > 0

  return attachments.some((attachment) => {
    const ext = getAttachmentExt(attachment)
    if (!ext) return false
    return normalizedExts.includes(ext)
  })
}

export function matchesImageExts(exts: string[] | undefined, attachments: InputAttachment[]): boolean {
  const imageAttachments = attachments.filter((attachment) => isImageAttachment(attachment))
  if (!exts || exts.length === 0) return imageAttachments.length > 0
  return matchesFiles(exts, imageAttachments)
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
      try {
        const regex = new RegExp(cmd.match)
        if (regex.test(text)) {
          matchType = 'regex'
        }
      } catch { }
    }

    if (cmd.type === 'keyword') {
      if (!hasText) continue
      if (cmd.value.toLowerCase().includes(q)) {
        matchType = 'keyword'
      }
    }

    if (cmd.type === 'files') {
      if (!hasAttachments) continue
      if (matchesFiles(cmd.exts, input.attachments)) {
        matchType = 'files'
      }
    }

    if (cmd.type === 'img') {
      if (!hasAttachments) continue
      if (matchesImageExts(cmd.exts, input.attachments)) {
        matchType = 'img'
      }
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
