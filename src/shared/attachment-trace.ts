import type { InputAttachment, InputPayload } from './types/plugin'

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8)
}

export function getAttachmentTraceKey(attachments: readonly Pick<InputAttachment, 'id'>[] = []): string {
  return attachments.map((attachment) => attachment.id).join('|')
}

export function formatAttachmentTrace(attachments: readonly InputAttachment[] = []): string {
  if (attachments.length === 0) return 'attachments=0'

  const summary = attachments.map((attachment, index) => (
    `${index}:${shortId(attachment.id)}:${attachment.name}:${attachment.kind}:size=${attachment.size}:path=${attachment.path ? 'y' : 'n'}:dataUrl=${attachment.dataUrl ? 'y' : 'n'}`
  ))

  return `attachments=${attachments.length} [${summary.join('; ')}]`
}

export function formatPayloadTrace(input?: Pick<InputPayload, 'text' | 'attachments'>): string {
  const text = input?.text || ''
  return `textLen=${text.length} ${formatAttachmentTrace(input?.attachments || [])}`
}
