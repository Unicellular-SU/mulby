import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InputAttachment, InputPayload } from '../../shared/types/plugin'

const DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
  'image/heif': '.heif'
}
const INVALID_FILENAME_CHARS = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])

interface ParsedImageDataUrl {
  mime: string
  buffer: Buffer
}

function parseImageDataUrl(dataUrl?: string): ParsedImageDataUrl | null {
  if (!dataUrl) return null
  const match = DATA_URL_PATTERN.exec(dataUrl.trim())
  if (!match) return null

  const mime = match[1].toLowerCase()
  const base64 = match[2].replace(/\s/g, '')
  if (!base64) return null

  try {
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length === 0) return null
    return { mime, buffer }
  } catch {
    return null
  }
}

function sanitizeFilePart(value: string): string {
  const normalized = Array.from(value.trim(), (char) => {
    const codePoint = char.codePointAt(0) ?? 0
    return codePoint < 32 || INVALID_FILENAME_CHARS.has(char) ? '-' : char
  }).join('')

  const compacted = normalized
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return compacted.slice(0, 80) || 'clipboard-image'
}

function extensionForAttachment(attachment: InputAttachment, mime: string): string {
  const ext = attachment.ext?.trim().toLowerCase()
  if (ext?.startsWith('.')) return ext
  if (ext) return `.${ext}`
  return MIME_EXTENSIONS[mime] || '.png'
}

export async function materializeDataUrlImageAttachments(
  input: InputPayload,
  attachmentDir: string
): Promise<InputPayload> {
  if (input.attachments.length === 0) return input

  let changed = false
  const attachments: InputAttachment[] = []

  for (const attachment of input.attachments) {
    if (attachment.path || !attachment.dataUrl) {
      attachments.push(attachment)
      continue
    }

    const parsed = parseImageDataUrl(attachment.dataUrl)
    if (!parsed) {
      attachments.push(attachment)
      continue
    }

    await mkdir(attachmentDir, { recursive: true })

    const ext = extensionForAttachment(attachment, parsed.mime)
    const nameBase = sanitizeFilePart(attachment.name.replace(/\.[^./\\]+$/, '') || attachment.id)
    const hash = createHash('sha256').update(parsed.buffer).digest('hex').slice(0, 16)
    const filePath = join(attachmentDir, `${nameBase}-${hash}${ext}`)
    await writeFile(filePath, parsed.buffer)

    attachments.push({
      ...attachment,
      kind: 'image',
      mime: attachment.mime || parsed.mime,
      ext,
      size: attachment.size > 0 ? attachment.size : parsed.buffer.byteLength,
      path: filePath
    })
    changed = true
  }

  return changed ? { ...input, attachments } : input
}
