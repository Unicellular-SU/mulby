import type { AiProviderConfig } from '../../../shared/types/ai'
import { BaseFileService } from './BaseFileService'

const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA_FILES = 'files-api-2025-04-14'

export class AnthropicFileService extends BaseFileService {
  private baseURL: string

  constructor(provider: AiProviderConfig) {
    super(provider)
    if (!provider.baseURL) {
      throw new Error('Anthropic file upload requires baseURL')
    }
    this.baseURL = provider.baseURL.replace(/\/+$/, '')
  }

  async uploadFile(input: { buffer: Buffer; filename: string; mimeType?: string; purpose?: string }) {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('Anthropic file upload requires apiKey')
    }
    const url = `${this.baseURL}/files`
    const form = new FormData()
    const blob = new Blob([new Uint8Array(input.buffer)], { type: input.mimeType || 'application/octet-stream' })
    form.append('file', blob, input.filename)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': ANTHROPIC_BETA_FILES
      },
      body: form
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic file upload failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const data = (await res.json()) as { id?: string; filename?: string }
    if (!data.id) {
      throw new Error('Anthropic file upload returned no file id')
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
      throw new Error('Anthropic file delete requires apiKey')
    }
    const url = `${this.baseURL}/files/${fileId}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': ANTHROPIC_BETA_FILES
      }
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic file delete failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }
  }

  async retrieveFile(fileId: string) {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('Anthropic file retrieve requires apiKey')
    }
    const url = `${this.baseURL}/files/${fileId}`
    const res = await fetch(url, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': ANTHROPIC_BETA_FILES
      }
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Anthropic file retrieve failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const data = (await res.json()) as { id?: string; filename?: string }
    if (!data.id) {
      throw new Error('Anthropic file retrieve returned no file id')
    }

    return {
      fileId: data.id,
      displayName: data.filename,
      status: 'success' as const
    }
  }
}
