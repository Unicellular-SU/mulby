/**
 * Custom API Provider — 用户自定义搜索 API
 */
import { httpGet, httpPost } from '../http'
import type { WebSearchResponse, WebSearchResult, CustomSearchApiConfig } from '../types'

/**
 * 对任意自定义搜索 API 发起请求并解析结果
 */
export async function customApiSearch(input: {
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
