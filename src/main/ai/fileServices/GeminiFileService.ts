import type { AiProviderConfig } from '../../../shared/types/ai'
import { BaseFileService } from './BaseFileService'

function resolveVersionedBaseURL(baseURL?: string): { baseURL: string; versionPath: string } {
  const trimmed = (baseURL || '').replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Gemini file upload requires baseURL')
  }
  const match = trimmed.match(/\/v\d+(beta)?$/i)
  if (!match) {
    throw new Error('Gemini baseURL must include version path like /v1beta or /v1')
  }
  return { baseURL: trimmed, versionPath: match[0] }
}

export class GeminiFileService extends BaseFileService {
  private baseURL: string
  private uploadURL: string

  constructor(provider: AiProviderConfig) {
    super(provider)
    const { baseURL, versionPath } = resolveVersionedBaseURL(provider.baseURL)
    const root = baseURL.slice(0, baseURL.length - versionPath.length)
    this.baseURL = baseURL
    this.uploadURL = `${root}/upload${versionPath}/files`
  }

  async uploadFile(input: { buffer: Buffer; filename: string; mimeType?: string; purpose?: string }) {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('Gemini file upload requires apiKey')
    }

    const startRes = await fetch(this.uploadURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(input.buffer.length),
        'X-Goog-Upload-Header-Content-Type': input.mimeType || 'application/octet-stream'
      },
      body: JSON.stringify({
        file: {
          display_name: input.filename
        }
      })
    })

    if (!startRes.ok) {
      const body = await startRes.text().catch(() => '')
      throw new Error(`Gemini file upload start failed: ${startRes.status} ${startRes.statusText}${body ? ` - ${body}` : ''}`)
    }

    const uploadUrl = startRes.headers.get('x-goog-upload-url')
    if (!uploadUrl) {
      throw new Error('Gemini upload did not return upload URL')
    }

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Type': input.mimeType || 'application/octet-stream'
      },
      body: new Uint8Array(input.buffer)
    })

    if (!uploadRes.ok) {
      const body = await uploadRes.text().catch(() => '')
      throw new Error(`Gemini file upload failed: ${uploadRes.status} ${uploadRes.statusText}${body ? ` - ${body}` : ''}`)
    }

    const data = (await uploadRes.json()) as { file?: { name?: string; uri?: string; displayName?: string } }
    const fileName = data.file?.name
    if (!fileName) {
      throw new Error('Gemini file upload returned no file id')
    }

    return {
      fileId: fileName,
      displayName: data.file?.displayName || input.filename,
      status: 'success' as const,
      uri: data.file?.uri
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('Gemini file delete requires apiKey')
    }
    const url = fileId.startsWith('files/') ? `${this.baseURL}/${fileId}` : `${this.baseURL}/files/${fileId}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'x-goog-api-key': apiKey
      }
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gemini file delete failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }
  }

  async retrieveFile(fileId: string) {
    const apiKey = this.provider.apiKey
    if (!apiKey) {
      throw new Error('Gemini file retrieve requires apiKey')
    }
    const url = fileId.startsWith('files/') ? `${this.baseURL}/${fileId}` : `${this.baseURL}/files/${fileId}`
    const res = await fetch(url, {
      headers: {
        'x-goog-api-key': apiKey
      }
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gemini file retrieve failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`)
    }

    const data = (await res.json()) as { name?: string; uri?: string; displayName?: string }
    if (!data.name) {
      throw new Error('Gemini file retrieve returned no file id')
    }

    return {
      fileId: data.name,
      displayName: data.displayName,
      status: 'success' as const,
      uri: data.uri
    }
  }
}
