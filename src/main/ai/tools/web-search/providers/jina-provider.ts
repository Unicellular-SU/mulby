/**
 * Jina Provider — Search API + Reader API
 */
import { httpGet } from '../http'
import type { WebSearchResponse, WebFetchResponse } from '../types'

// ==================== Jina API 响应类型 ====================

interface JinaSearchResultItem {
  title?: string
  url?: string
  content?: string
  description?: string
}

interface JinaSearchApiResponse {
  code?: number
  data?: JinaSearchResultItem[]
}

interface JinaReaderApiResponse {
  code?: number
  data?: {
    title?: string
    url?: string
    content?: string
  }
}

// ==================== Jina Search ====================

export async function jinaSearch(input: {
  query: string
  maxResults: number
  language?: string
  timeoutMs: number
  apiKey: string
}): Promise<WebSearchResponse> {
  // Jina Search API: GET https://s.jina.ai/{query}
  const encodedQuery = encodeURIComponent(input.query)
  const url = `https://s.jina.ai/${encodedQuery}`

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Retain-Images': 'none',
    Authorization: `Bearer ${input.apiKey}`
  }
  if (input.language) {
    headers['Accept-Language'] = input.language
  }

  const response = await httpGet({
    url,
    headers,
    timeoutMs: input.timeoutMs,
    maxBytes: 2 * 1024 * 1024
  })

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Jina search API returned status ${response.status}`)
  }

  let parsed: JinaSearchApiResponse
  try {
    parsed = JSON.parse(response.body)
  } catch {
    throw new Error('Failed to parse Jina search response')
  }

  const items = Array.isArray(parsed.data) ? parsed.data : []
  const results = items
    .slice(0, input.maxResults)
    .map((item) => ({
      title: String(item.title || '').trim() || 'Untitled',
      url: String(item.url || '').trim(),
      content: String(item.content || '').trim(),
      snippet: String(item.description || '').trim() || undefined
    }))
    .filter((item) => item.url)

  return {
    success: true,
    query: input.query,
    results
  }
}

// ==================== Jina Reader (web_fetch) ====================

export async function jinaFetch(input: {
  url: string
  timeoutMs: number
  maxLength: number
  apiKey?: string
}): Promise<WebFetchResponse> {
  // Jina Reader API: GET https://r.jina.ai/{url}
  const readerUrl = `https://r.jina.ai/${input.url}`

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Retain-Images': 'none'
  }
  if (input.apiKey) {
    headers['Authorization'] = `Bearer ${input.apiKey}`
  }

  const response = await httpGet({
    url: readerUrl,
    headers,
    timeoutMs: input.timeoutMs,
    maxBytes: 2 * 1024 * 1024
  })

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Jina reader API returned status ${response.status}`)
  }

  let parsed: JinaReaderApiResponse
  try {
    parsed = JSON.parse(response.body)
  } catch {
    throw new Error('Failed to parse Jina reader response')
  }

  const data = parsed.data || {}
  let content = String(data.content || '').trim()
  let truncated = false
  if (content.length > input.maxLength) {
    content = content.slice(0, input.maxLength)
    truncated = true
  }

  return {
    success: true,
    url: input.url,
    title: String(data.title || '').trim() || input.url,
    content: content || 'No content found',
    format: 'markdown',
    truncated
  }
}
