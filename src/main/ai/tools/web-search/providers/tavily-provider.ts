/**
 * Tavily Provider — 搜索 API
 */
import { httpPost } from '../http'
import type { WebSearchResponse, WebSearchResult } from '../types'

export async function tavilySearch(input: {
  query: string
  maxResults: number
  apiKey: string
  timeoutMs: number
  apiHost?: string
}): Promise<WebSearchResponse> {
  const baseUrl = input.apiHost || 'https://api.tavily.com'
  const url = `${baseUrl.replace(/\/$/, '')}/search`
  const body = JSON.stringify({
    query: input.query,
    max_results: input.maxResults,
    api_key: input.apiKey,
    include_answer: false,
    include_raw_content: false
  })

  const response = await httpPost({
    url,
    body,
    timeoutMs: input.timeoutMs,
    maxBytes: 2 * 1024 * 1024
  })

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Tavily search API returned status ${response.status}: ${response.body.slice(0, 200)}`)
  }

  let parsed: { results?: { title?: string; url?: string; content?: string }[] }
  try {
    parsed = JSON.parse(response.body)
  } catch {
    throw new Error('Failed to parse Tavily response')
  }

  const results: WebSearchResult[] = (parsed.results || []).map(
    (item) => ({
      title: String(item.title || '').trim() || 'Untitled',
      url: String(item.url || '').trim(),
      content: String(item.content || '').trim()
    })
  )

  return {
    success: true,
    query: input.query,
    results
  }
}
