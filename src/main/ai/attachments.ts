import { app } from 'electron'
import { existsSync, mkdirSync, promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { AiAttachmentRef } from '../../shared/types/ai'

interface AttachmentRecord extends AiAttachmentRef {
  filePath: string
  createdAt: number
  remote?: Array<{
    providerId: string
    fileId: string
    purpose?: string
    uri?: string
    createdAt: number
  }>
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

  getPath(attachmentId: string): string | null {
    const record = this.records.get(attachmentId)
    return record ? record.filePath : null
  }

  getRemote(
    attachmentId: string,
    input: { providerId: string; purpose?: string }
  ): { providerId: string; fileId: string; purpose?: string; uri?: string } | null {
    const record = this.records.get(attachmentId)
    if (!record?.remote || record.remote.length === 0) return null
    const match = record.remote.find((item) => item.providerId === input.providerId && item.purpose === input.purpose)
    return match ? { providerId: match.providerId, fileId: match.fileId, purpose: match.purpose, uri: match.uri } : null
  }

  setRemote(
    attachmentId: string,
    remote: { providerId: string; fileId: string; purpose?: string; uri?: string }
  ): void {
    const record = this.records.get(attachmentId)
    if (!record) return
    if (!record.remote) {
      record.remote = []
    }
    const existing = record.remote.findIndex(
      (item) => item.providerId === remote.providerId && item.purpose === remote.purpose
    )
    const payload = { ...remote, createdAt: Date.now() }
    if (existing >= 0) {
      record.remote[existing] = payload
    } else {
      record.remote.push(payload)
    }
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
