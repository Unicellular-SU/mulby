import type { AiProviderConfig } from '../../../shared/types/ai'
import { BaseFileService } from './BaseFileService'

export class OpenAIFileService extends BaseFileService {
  private baseURL: string

  constructor(provider: AiProviderConfig) {
    super(provider)
    if (!provider.baseURL) {
      throw new Error('OpenAI file upload requires baseURL')
    }
    this.baseURL = provider.baseURL.replace(/\/+$/, '')
  }

  async uploadFile(input: { buffer: Buffer; filename: string; mimeType?: string; purpose?: string }) {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('OpenAI file upload requires apiKey')
    }
    const url = `${this.baseURL}/files`
    const form = new FormData()
    const blob = new Blob([new Uint8Array(input.buffer)], { type: input.mimeType || 'application/octet-stream' })
    form.append('file', blob, input.filename)
    form.append('purpose', input.purpose || 'assistants')

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenAI file upload failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const data = (await res.json()) as { id?: string; filename?: string }
    if (!data.id) {
      throw new Error('OpenAI file upload returned no file id')
    }

    return {
      fileId: data.id,
      displayName: data.filename || input.filename,
      status: 'success' as const
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('OpenAI file delete requires apiKey')
    }
    const url = `${this.baseURL}/files/${fileId}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenAI file delete failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }
  }

  async retrieveFile(fileId: string) {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('OpenAI file retrieve requires apiKey')
    }
    const url = `${this.baseURL}/files/${fileId}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenAI file retrieve failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const data = (await res.json()) as { id?: string; filename?: string }
    if (!data.id) {
      throw new Error('OpenAI file retrieve returned no file id')
    }

    return {
      fileId: data.id,
      displayName: data.filename,
      status: 'success' as const
    }
  }
}
