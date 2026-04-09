/**
 * Web 搜索与网页内容提取 — 共享类型定义
 */
import type { CustomSearchApiConfig } from '../../../../shared/types/settings'

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
    snippetSelector?: string
    urlDecoder?: string
    maxResults: number
    timeoutMs: number
    language?: string
  }): Promise<WebSearchResult[]>

  /**
   * 获取单个页面的正文内容（可选能力）
   *
   * 通过 BrowserWindow 加载目标 URL，用启发式方法提取主要正文。
   */
  fetchContent?(input: {
    url: string
    timeoutMs: number
    maxLength: number
  }): Promise<{ content: string; title?: string }>
}

// re-export 以便 Provider 使用
export type { CustomSearchApiConfig }
