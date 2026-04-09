/**
 * Web 搜索与网页内容提取服务（调度器）
 *
 * 三层 Provider 架构：
 * 1. 本地搜索（local-ddg / local-bing / local-google / 用户自定义）— 零成本
 * 2. 内置 API（tavily / jina）— 需要 API Key
 * 3. 自定义 API — 用户自行添加的搜索接口
 */
import type { AiToolWebSearchSettings } from '../../../../shared/types/settings'
import { isPrivateUrl } from './http'
import { jinaSearch, jinaFetch } from './providers/jina-provider'
import { tavilySearch } from './providers/tavily-provider'
import { customApiSearch } from './providers/custom-provider'
import type {
  WebSearchResult,
  WebSearchResponse,
  WebFetchResponse,
  LocalSearchExecutor
} from './types'

export class WebSearchService {
  private localExecutor: LocalSearchExecutor | null = null

  constructor(private readonly settings: AiToolWebSearchSettings) { }

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
      return this.localSearch(input.query, providerId, maxResults, input.language)
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
      const response = await tavilySearch({
        query: input.query,
        maxResults,
        apiKey,
        timeoutMs: this.settings.timeoutMs,
        apiHost: this.settings.tavilyApiHost
      })
      response.results = this.filterByDenyHosts(response.results)
      return response
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
      const response = await jinaSearch({
        query: input.query,
        maxResults,
        language: input.language,
        timeoutMs: this.settings.timeoutMs,
        apiKey
      })
      response.results = this.filterByDenyHosts(response.results)
      return response
    }

    // ---- 自定义 API（activeProvider 格式：custom-{id}） ----
    if (providerId.startsWith('custom-')) {
      const rawId = providerId.slice('custom-'.length)
      const customConfig = this.settings.customApis.find(a => a.id === rawId)
      if (customConfig) {
        const response = await customApiSearch({
          query: input.query,
          maxResults,
          config: customConfig,
          timeoutMs: this.settings.timeoutMs
        })
        response.results = this.filterByDenyHosts(response.results)
        return response
      }
    }

    // 未知 Provider → 回退到 local-ddg
    return this.localSearch(input.query, 'local-ddg', maxResults, input.language)
  }

  async fetch(input: {
    url: string
    maxLength?: number
  }): Promise<WebFetchResponse> {
    const maxLength = Math.max(
      500,
      Math.min(input.maxLength || this.settings.maxContentLength, 50_000)
    )

    // 优先走 Jina Reader API
    try {
      return await jinaFetch({
        url: input.url,
        timeoutMs: this.settings.timeoutMs,
        maxLength,
        apiKey: this.settings.providerKeys.jina
      })
    } catch (jinaError) {
      // Jina 失败后降级到本地 BrowserWindow 获取
      if (this.localExecutor?.fetchContent) {
        console.debug(`[WebSearch] Jina Reader 失败，降级到本地获取: ${jinaError instanceof Error ? jinaError.message : jinaError}`)
        try {
          const local = await this.localExecutor.fetchContent({
            url: input.url,
            timeoutMs: this.settings.timeoutMs,
            maxLength
          })
          // 本地获取到有效内容才算成功，空内容视为失败
          if (local.content && local.content.trim().length > 0) {
            return {
              success: true,
              url: input.url,
              title: local.title || input.url,
              content: local.content,
              format: 'text',
              truncated: local.content.length >= maxLength
            }
          }
          // 空内容 → 继续抛出原始 Jina 错误
        } catch {
          // 本地也失败，抛出原始 Jina 错误
        }
      }
      throw jinaError
    }
  }

  // ---- 本地搜索 ----
  private async localSearch(
    query: string,
    providerId: string,
    maxResults: number,
    language?: string
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

    // 记录搜索开始时间，用于全局超时预算管理
    const searchStart = Date.now()
    const totalBudgetMs = this.settings.timeoutMs

    let results = await this.localExecutor.search({
      urlTemplate: engine.urlTemplate,
      query,
      resultSelector: engine.resultSelector,
      titleSelector: engine.titleSelector,
      linkSelector: engine.linkSelector,
      snippetSelector: engine.snippetSelector,
      urlDecoder: engine.urlDecoder,
      maxResults,
      timeoutMs: totalBudgetMs,
      language
    })

    // 黑名单过滤
    const beforeFilter = results.length
    results = this.filterByDenyHosts(results)
    if (beforeFilter !== results.length) {
      console.debug(`[WebSearch] 黑名单过滤: ${beforeFilter} → ${results.length}`)
    }

    // 并发获取正文内容（如果启用且执行器支持）
    // 使用剩余时间预算，避免总耗时超出 timeoutMs
    if (this.settings.fetchContent !== false && this.localExecutor.fetchContent) {
      const elapsed = Date.now() - searchStart
      const remainingMs = totalBudgetMs - elapsed
      if (remainingMs > 2000) { // 至少留 2 秒给正文获取才有意义
        results = await this.fetchContentsForResults(results, remainingMs)
        const fetched = results.filter(r => !!r.content).length
        console.debug(`[WebSearch] 正文获取: ${fetched}/${results.length} 成功（耗时 ${Date.now() - searchStart - elapsed}ms）`)
      } else {
        console.debug(`[WebSearch] 跳过正文获取（剩余时间 ${remainingMs}ms 不足）`)
      }
    }

    console.debug(`[WebSearch] 本地搜索完成: engine=${providerId}, query="${query}", results=${results.length}, 总耗时=${Date.now() - searchStart}ms`)

    return {
      success: true,
      query,
      results
    }
  }

  // ---- 黑名单过滤 ----
  private filterByDenyHosts(results: WebSearchResult[]): WebSearchResult[] {
    const denyHosts = this.settings.resultDenyHosts
    if (!denyHosts || denyHosts.length === 0) return results

    return results.filter(r => {
      try {
        const host = new URL(r.url).hostname.toLowerCase()
        return !denyHosts.some(deny => {
          const denyLower = deny.toLowerCase()
          return host === denyLower || host.endsWith(`.${denyLower}`)
        })
      } catch {
        return true // URL 解析失败时保留
      }
    })
  }

  // ---- 并发获取正文 ----
  private async fetchContentsForResults(
    results: WebSearchResult[],
    budgetMs: number
  ): Promise<WebSearchResult[]> {
    if (!this.localExecutor?.fetchContent || results.length === 0) return results

    const maxLength = this.settings.maxContentPerResult || 2000
    const concurrency = 3
    const executor = this.localExecutor
    const deadline = Date.now() + budgetMs

    // 按批次并发获取，受整体预算约束
    const enriched = [...results]
    for (let i = 0; i < enriched.length; i += concurrency) {
      const remaining = deadline - Date.now()
      if (remaining <= 1000) break // 剩余不足 1 秒，放弃后续批次

      const batch = enriched.slice(i, i + concurrency)
      // 单页超时 = min(剩余预算, 10s)，确保不会超出总预算
      const perPageTimeout = Math.min(remaining, 10_000)

      const fetches = batch.map(async (item, batchIdx) => {
        try {
          // 阻止对内网 / 本地地址的请求（防止 SSRF）
          if (isPrivateUrl(item.url)) return

          const result = await executor.fetchContent!({
            url: item.url,
            timeoutMs: perPageTimeout,
            maxLength
          })
          enriched[i + batchIdx] = {
            ...item,
            content: result.content || item.content
          }
        } catch {
          // 单个页面获取失败不影响其他结果
        }
      })
      await Promise.all(fetches)
    }

    return enriched
  }
}
