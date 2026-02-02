import { app } from 'electron'
import { existsSync, mkdirSync, promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { AiAttachmentRef } from '../../shared/types/ai'

interface AttachmentRecord extends AiAttachmentRef {
  filePath: string
  createdAt: number
}

function getAttachmentDir(): string {
  const dir = join(app.getPath('userData'), 'ai', 'attachments')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export class AttachmentStore {
  private records = new Map<string, AttachmentRecord>()

  async upload(input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }): Promise<AiAttachmentRef> {
    const id = randomUUID()
    const dir = getAttachmentDir()
    const targetPath = join(dir, id)

    if (input.filePath) {
      const stat = await fs.stat(input.filePath)
      await fs.copyFile(input.filePath, targetPath)
      const record: AttachmentRecord = {
        attachmentId: id,
        mimeType: input.mimeType,
        size: stat.size,
        filename: input.filePath.split('/').pop(),
        purpose: input.purpose,
        filePath: targetPath,
        createdAt: Date.now()
      }
      this.records.set(id, record)
      return record
    }

    if (input.buffer) {
      const buffer = Buffer.from(input.buffer)
      await fs.writeFile(targetPath, buffer)
      const record: AttachmentRecord = {
        attachmentId: id,
        mimeType: input.mimeType,
        size: buffer.length,
        filename: undefined,
        purpose: input.purpose,
        filePath: targetPath,
        createdAt: Date.now()
      }
      this.records.set(id, record)
      return record
    }

    throw new Error('Attachment upload requires filePath or buffer')
  }

  get(attachmentId: string): AiAttachmentRef | null {
    const record = this.records.get(attachmentId)
    if (!record) return null
    return record
  }

  async read(attachmentId: string): Promise<Buffer> {
    const record = this.records.get(attachmentId)
    if (!record) {
      throw new Error(`Attachment not found: ${attachmentId}`)
    }
    return await fs.readFile(record.filePath)
  }

  async delete(attachmentId: string): Promise<void> {
    const record = this.records.get(attachmentId)
    if (!record) return
    this.records.delete(attachmentId)
    try {
      await fs.unlink(record.filePath)
    } catch {
      // ignore
    }
  }
}

export const attachmentStore = new AttachmentStore()
