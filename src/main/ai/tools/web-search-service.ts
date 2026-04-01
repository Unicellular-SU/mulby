/**
 * Web 搜索与网页内容提取服务
 *
 * 三层 Provider 架构：
 * 1. 本地搜索（local-bing / local-google / 用户自定义）— 隐藏 BrowserWindow 爬取，零成本
 * 2. 内置 API（tavily / jina）— 需要 API Key
 * 3. 自定义 API — 用户自行添加的搜索接口
 */
import https from 'node:https'
import http from 'node:http'
import type { AiToolWebSearchSettings, CustomSearchApiConfig } from '../../../shared/types/settings'

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

/**
 * 本地搜索引擎执行器接口
 *
 * 由 SearchWindowService 在 main 进程中实现，
 * 通过 BrowserWindow 加载搜索引擎 URL 并解析 HTML。
 */
export interface LocalSearchExecutor {
  search(input: {
    urlTemplate: string
    query: string
    resultSelector: string
    titleSelector: string
    linkSelector: string
    urlDecoder?: string
    maxResults: number
    timeoutMs: number
  }): Promise<WebSearchResult[]>
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

function httpPost(input: {
  url: string
  headers?: Record<string, string>
  body: string
  timeoutMs: number
  maxBytes: number
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(input.url)
    const requester = parsedUrl.protocol === 'https:' ? https : http

    const req = requester.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(input.body)),
          ...input.headers
        }
      },
      (res) => {
        const status = Number(res.statusCode || 0)
        const chunks: Buffer[] = []
        let bytes = 0

        res.on('data', (chunk: Buffer) => {
          const data = Buffer.from(chunk)
          if (bytes < input.maxBytes) {
            const remaining = input.maxBytes - bytes
            chunks.push(data.length <= remaining ? data : data.subarray(0, remaining))
            bytes += data.length
          }
        })

        res.on('end', () => {
          resolve({
            status,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })

        res.on('error', (error) => reject(error))
      }
    )

    req.setTimeout(input.timeoutMs, () => {
      req.destroy(new Error('HTTP POST request timeout'))
    })

    req.on('error', (error) => reject(error))
    req.write(input.body)
    req.end()
  })
}

// ==================== Jina Provider ====================

async function jinaSearch(input: {
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

// ==================== Tavily Provider ====================

async function tavilySearch(input: {
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

// ==================== Custom API Provider ====================

/**
 * 对任意自定义搜索 API 发起请求并解析结果
 */
async function customApiSearch(input: {
  query: string
  maxResults: number
  config: CustomSearchApiConfig
  timeoutMs: number
}): Promise<WebSearchResponse> {
  const { config } = input

  let responseBody: string

  if (config.method === 'GET') {
    const param = config.queryParam || 'q'
    const url = `${config.apiHost.replace(/\/$/, '')}?${param}=${encodeURIComponent(input.query)}`
    const headers: Record<string, string> = {}
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`
    }
    const response = await httpGet({ url, headers, timeoutMs: input.timeoutMs, maxBytes: 2 * 1024 * 1024 })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Custom search API '${config.name}' returned status ${response.status}`)
    }
    responseBody = response.body
  } else {
    // POST
    const bodyTemplate = config.bodyTemplate || `{"query": "%s"}`
    const body = bodyTemplate.replace(/%s/g, input.query.replace(/"/g, '\\"'))
    const headers: Record<string, string> = {}
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`
    }
    const response = await httpPost({
      url: config.apiHost.replace(/\/$/, ''),
      body,
      headers,
      timeoutMs: input.timeoutMs,
      maxBytes: 2 * 1024 * 1024
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Custom search API '${config.name}' returned status ${response.status}`)
    }
    responseBody = response.body
  }

  // 解析响应
  let parsed: any
  try {
    parsed = JSON.parse(responseBody)
  } catch {
    throw new Error(`Failed to parse response from custom search API '${config.name}'`)
  }

  // 用配置的 JSON path 获取结果数组
  const resultsPath = config.resultsPath || 'results'
  let rawResults = parsed
  for (const key of resultsPath.split('.')) {
    rawResults = rawResults?.[key]
  }
  if (!Array.isArray(rawResults)) rawResults = []

  const titleField = config.titleField || 'title'
  const urlField = config.urlField || 'url'
  const contentField = config.contentField || 'content'

  const results: WebSearchResult[] = rawResults
    .slice(0, input.maxResults)
    .map((item: any) => ({
      title: String(item[titleField] || '').trim() || 'Untitled',
      url: String(item[urlField] || '').trim(),
      content: String(item[contentField] || '').trim()
    }))
    .filter((item: WebSearchResult) => item.url)

  return {
    success: true,
    query: input.query,
    results
  }
}

// ==================== 统一服务类 ====================

export class WebSearchService {
  private localExecutor: LocalSearchExecutor | null = null

  constructor(private readonly settings: AiToolWebSearchSettings) {}

  /**
   * 注入本地搜索执行器（由 SearchWindowService 提供）
   */
  setLocalExecutor(executor: LocalSearchExecutor): void {
    this.localExecutor = executor
  }

  async search(input: {
    query: string
    maxResults?: number
    language?: string
  }): Promise<WebSearchResponse> {
    const maxResults = Math.max(
      1,
      Math.min(input.maxResults || this.settings.maxResults, 20)
    )

    const providerId = this.settings.activeProvider

    // ---- 本地搜索引擎（用 localEngines 集合匹配，而非仅看前缀） ----
    const isLocalEngine = this.settings.localEngines.some(e => e.id === providerId)
    if (isLocalEngine) {
      return this.localSearch(input.query, providerId, maxResults)
    }

    // ---- 内置 API: Tavily ----
    if (providerId === 'tavily') {
      const apiKey = this.settings.providerKeys.tavily
      if (!apiKey) {
        throw new Error(
          '使用 Tavily 搜索需要配置 API Key。\n' +
          '请前往 AI 设置 → 工具设置 中配置，或切换到免费的本地搜索（Bing/Google）。\n' +
          'API Key 申请：https://app.tavily.com/home'
        )
      }
      return await tavilySearch({
        query: input.query,
        maxResults,
        apiKey,
        timeoutMs: this.settings.timeoutMs,
        apiHost: this.settings.tavilyApiHost
      })
    }

    // ---- 内置 API: Jina ----
    if (providerId === 'jina') {
      const apiKey = this.settings.providerKeys.jina
      if (!apiKey) {
        throw new Error(
          '使用 Jina 搜索需要配置 API Key。\n' +
          '请前往 AI 设置 → 工具设置 中配置，或切换到免费的本地搜索（Bing/Google）。\n' +
          'API Key 申请：https://jina.ai/reader'
        )
      }
      return await jinaSearch({
        query: input.query,
        maxResults,
        language: input.language,
        timeoutMs: this.settings.timeoutMs,
        apiKey
      })
    }

    // ---- 自定义 API（activeProvider 格式：custom-{id}） ----
    if (providerId.startsWith('custom-')) {
      const rawId = providerId.slice('custom-'.length)
      const customConfig = this.settings.customApis.find(a => a.id === rawId)
      if (customConfig) {
        return await customApiSearch({
          query: input.query,
          maxResults,
          config: customConfig,
          timeoutMs: this.settings.timeoutMs
        })
      }
    }

    // 未知 Provider → 回退到 local-bing
    return this.localSearch(input.query, 'local-bing', maxResults)
  }

  async fetch(input: {
    url: string
    maxLength?: number
  }): Promise<WebFetchResponse> {
    const maxLength = Math.max(
      500,
      Math.min(input.maxLength || this.settings.maxContentLength, 50_000)
    )

    // web_fetch 始终通过 Jina Reader（免费 tier 仍可用于单页抓取）
    // 如果用户配置了 Jina Key 则带上
    return await jinaFetch({
      url: input.url,
      timeoutMs: this.settings.timeoutMs,
      maxLength,
      apiKey: this.settings.providerKeys.jina
    })
  }

  // ---- 本地搜索 ----
  private async localSearch(
    query: string,
    providerId: string,
    maxResults: number
  ): Promise<WebSearchResponse> {
    if (!this.localExecutor) {
      throw new Error(
        '本地搜索功能尚未初始化。这通常发生在应用启动的头几秒，请稍后重试。'
      )
    }

    const engine = this.settings.localEngines.find(e => e.id === providerId)
    if (!engine) {
      throw new Error(`未找到本地搜索引擎: ${providerId}`)
    }

    const results = await this.localExecutor.search({
      urlTemplate: engine.urlTemplate,
      query,
      resultSelector: engine.resultSelector,
      titleSelector: engine.titleSelector,
      linkSelector: engine.linkSelector,
      urlDecoder: engine.urlDecoder,
      maxResults,
      timeoutMs: this.settings.timeoutMs
    })

    return {
      success: true,
      query,
      results
    }
  }
}
