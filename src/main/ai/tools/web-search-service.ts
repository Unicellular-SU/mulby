/**
 * Web 搜索与网页内容提取服务
 *
 * 默认使用 Jina Search/Reader API（免费、零依赖），支持扩展 Tavily 等付费方案。
 * - 搜索: s.jina.ai — 返回搜索结果 + Markdown 内容
 * - 抓取: r.jina.ai — 将任意 URL 转为 LLM 友好的 Markdown
 */
import https from 'node:https'
import http from 'node:http'
import type { AiToolWebSearchSettings } from '../../../shared/types/settings'

// ==================== 类型定义 ====================

export interface WebSearchResult {
  title: string
  url: string
  content: string
  snippet?: string
}

export interface WebSearchResponse {
  success: boolean
  query: string
  results: WebSearchResult[]
}

export interface WebFetchResponse {
  success: boolean
  url: string
  title: string
  content: string
  format: string
  truncated: boolean
}

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

// ==================== HTTP 请求辅助 ====================

function httpGet(input: {
  url: string
  headers?: Record<string, string>
  timeoutMs: number
  maxBytes: number
}): Promise<{ status: number; body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(input.url)
    const requester = parsedUrl.protocol === 'https:' ? https : http

    const req = requester.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'GET',
        headers: input.headers || {}
      },
      (res) => {
        // 跟踪重定向
        const status = Number(res.statusCode || 0)
        if (status >= 300 && status < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, parsedUrl).toString()
          httpGet({ ...input, url: redirectUrl })
            .then(resolve)
            .catch(reject)
          return
        }

        const chunks: Buffer[] = []
        let bytes = 0
        let truncated = false

        res.on('data', (chunk: Buffer) => {
          const data = Buffer.from(chunk)
          if (bytes >= input.maxBytes) {
            truncated = true
            return
          }
          const remaining = input.maxBytes - bytes
          if (data.length <= remaining) {
            chunks.push(data)
            bytes += data.length
          } else {
            chunks.push(data.subarray(0, remaining))
            bytes = input.maxBytes
            truncated = true
          }
        })

        res.on('end', () => {
          resolve({
            status,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated
          })
        })

        res.on('error', (error) => reject(error))
      }
    )

    req.setTimeout(input.timeoutMs, () => {
      req.destroy(new Error('Web fetch request timeout'))
    })

    req.on('error', (error) => reject(error))
    req.end()
  })
}

// ==================== Jina Provider ====================

async function jinaSearch(input: {
  query: string
  maxResults: number
  language?: string
  timeoutMs: number
  apiKey?: string
}): Promise<WebSearchResponse> {
  // Jina Search API: GET https://s.jina.ai/{query}
  const encodedQuery = encodeURIComponent(input.query)
  const url = `https://s.jina.ai/${encodedQuery}`

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Retain-Images': 'none'
  }
  if (input.apiKey) {
    headers['Authorization'] = `Bearer ${input.apiKey}`
  }
  if (input.language) {
    // Jina 支持通过 Accept-Language 头指定语言偏好
    headers['Accept-Language'] = input.language
  }

  const response = await httpGet({
    url,
    headers,
    timeoutMs: input.timeoutMs,
    maxBytes: 2 * 1024 * 1024 // 2MB 响应上限
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
  const results: WebSearchResult[] = items
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

async function jinaFetch(input: {
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

// ==================== Tavily Provider（可扩展） ====================

async function tavilySearch(input: {
  query: string
  maxResults: number
  apiKey: string
  timeoutMs: number
}): Promise<WebSearchResponse> {
  const url = 'https://api.tavily.com/search'
  const body = JSON.stringify({
    query: input.query,
    max_results: input.maxResults,
    api_key: input.apiKey,
    include_answer: false,
    include_raw_content: false
  })

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        const status = Number(res.statusCode || 0)
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8')
          // P3: 非 2xx 状态码视为失败，避免将错误响应伪装为空结果
          if (status < 200 || status >= 300) {
            reject(new Error(`Tavily search API returned status ${status}: ${responseBody.slice(0, 200)}`))
            return
          }
          try {
            const parsed = JSON.parse(responseBody)
            const results: WebSearchResult[] = (parsed.results || []).map(
              (item: { title?: string; url?: string; content?: string }) => ({
                title: String(item.title || '').trim() || 'Untitled',
                url: String(item.url || '').trim(),
                content: String(item.content || '').trim()
              })
            )
            resolve({
              success: true,
              query: input.query,
              results
            })
          } catch {
            reject(new Error('Failed to parse Tavily response'))
          }
        })
        res.on('error', (error) => reject(error))
      }
    )

    req.setTimeout(input.timeoutMs, () => {
      req.destroy(new Error('Tavily search request timeout'))
    })

    req.on('error', (error) => reject(error))
    req.write(body)
    req.end()
  })
}

// ==================== 统一服务类 ====================

export class WebSearchService {
  constructor(private readonly settings: AiToolWebSearchSettings) {}

  async search(input: {
    query: string
    maxResults?: number
    language?: string
  }): Promise<WebSearchResponse> {
    const maxResults = Math.max(
      1,
      Math.min(input.maxResults || this.settings.maxResults, 20)
    )

    if (this.settings.provider === 'tavily') {
      if (!this.settings.tavilyApiKey) {
        throw new Error('Tavily API key is required when using tavily provider')
      }
      return await tavilySearch({
        query: input.query,
        maxResults,
        apiKey: this.settings.tavilyApiKey,
        timeoutMs: this.settings.timeoutMs
      })
    }

    // 默认 Jina
    return await jinaSearch({
      query: input.query,
      maxResults,
      language: input.language,
      timeoutMs: this.settings.timeoutMs,
      apiKey: this.settings.jinaApiKey
    })
  }

  async fetch(input: {
    url: string
    maxLength?: number
  }): Promise<WebFetchResponse> {
    const maxLength = Math.max(
      500,
      Math.min(input.maxLength || this.settings.maxContentLength, 50_000)
    )

    // Jina Reader 始终返回 Markdown，format 如实报告
    return await jinaFetch({
      url: input.url,
      timeoutMs: this.settings.timeoutMs,
      maxLength,
      apiKey: this.settings.jinaApiKey
    })
  }
}
