/**
 * 搜索窗口服务 — 管理隐藏 BrowserWindow 实现本地搜索引擎爬取
 *
 * 参考 Cherry Studio 的 SearchService 设计：
 * - 创建不可见的 BrowserWindow 加载搜索引擎页面
 * - 等待页面渲染完成后获取 DOM HTML
 * - 使用 cheerio 在 main 进程中解析搜索结果
 *
 * 实现 LocalSearchExecutor 接口，注入到 WebSearchService 中。
 */
import { BrowserWindow, app, net } from 'electron'
import * as cheerio from 'cheerio'
import type { LocalSearchExecutor, WebSearchResult } from '../ai/tools/web-search'

// ==================== URL 解码策略 ====================

/**
 * 解码 Bing 重定向 URL
 *
 * Bing 搜索结果链接格式: https://www.bing.com/ck/a?...&u=a1aHR0cHM6Ly93d3cuZXhhbXBsZS5jb20...
 * 'u' 参数包含 Base64 编码的原始 URL，前缀为 'a1'
 */
function decodeBingRedirectUrl(bingUrl: string): string {
  try {
    const url = new URL(bingUrl)
    const encodedUrl = url.searchParams.get('u')
    if (!encodedUrl) return bingUrl

    // 移除 'a1' 前缀后解码 Base64
    const base64Part = encodedUrl.substring(2)
    const decoded = Buffer.from(base64Part, 'base64').toString('utf8')
    if (decoded.startsWith('http')) return decoded
    return bingUrl
  } catch {
    return bingUrl
  }
}

/**
 * 解码 DuckDuckGo 重定向 URL
 *
 * DuckDuckGo HTML 版结果链接格式: //duckduckgo.com/l/?uddg=<encoded-url>&rut=...
 * 'uddg' 参数包含 URL-encoded 的原始 URL
 */
function decodeDdgRedirectUrl(ddgUrl: string): string {
  try {
    // 直接链接（非重定向）直接返回
    if (!ddgUrl.includes('duckduckgo.com/l/')) return ddgUrl
    const url = new URL(ddgUrl, 'https://duckduckgo.com')
    const target = url.searchParams.get('uddg')
    if (target && target.startsWith('http')) return target
    return ddgUrl
  } catch {
    return ddgUrl
  }
}

const URL_DECODERS: Record<string, (url: string) => string> = {
  'bing-redirect': decodeBingRedirectUrl,
  'ddg-redirect': decodeDdgRedirectUrl
}

// ==================== 启发式正文提取标签 ====================

/** 需要从 HTML 中移除的噪声标签 */
const NOISE_TAGS = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe', 'noscript', 'svg', 'form']

/** 优先提取正文的语义选择器（按优先级排列） */
const CONTENT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.post-content',
  '.article-content',
  '.entry-content',
  '.content',
  '#content',
  '.markdown-body',
  '.post-body'
]

// ==================== 搜索窗口服务 ====================

export class SearchWindowService implements LocalSearchExecutor {
  private static instance: SearchWindowService | null = null

  static getInstance(): SearchWindowService {
    if (!SearchWindowService.instance) {
      SearchWindowService.instance = new SearchWindowService()
    }
    return SearchWindowService.instance
  }

  /**
   * 通过隐藏 BrowserWindow 加载搜索 URL，然后用 cheerio 解析 HTML
   */
  async search(input: {
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
  }): Promise<WebSearchResult[]> {
    const query = input.query

    const searchUrl = input.urlTemplate.replace(
      /%s/g,
      encodeURIComponent(query)
    )
    console.debug(`[SearchWindow] 搜索: "${query}" → ${searchUrl}`)

    // DuckDuckGo HTML 版不需要 JS 渲染，用轻量 HTTP 请求替代 BrowserWindow
    const html = searchUrl.includes('html.duckduckgo.com')
      ? await this.fetchStaticHtml(searchUrl, input.timeoutMs)
      : await this.fetchRenderedHtml(searchUrl, input.timeoutMs)

    // 2. 用 cheerio 解析搜索结果
    const $ = cheerio.load(html)
    const urlDecoder = input.urlDecoder ? URL_DECODERS[input.urlDecoder] : undefined
    const results: WebSearchResult[] = []
    const seenUrls = new Set<string>()

    $(input.resultSelector).each((_i, el) => {
      if (results.length >= input.maxResults) return false

      const $el = $(el)
      const $titleEl = $el.find(input.titleSelector).first()
      const $linkEl = $el.find(input.linkSelector).first()

      const title = $titleEl.text().trim()
      let url = $linkEl.attr('href') || ''

      if (!url || !title) return

      // 应用 URL 解码策略
      if (urlDecoder && url) {
        url = urlDecoder(url)
      }

      // 过滤非 HTTP 链接
      if (!url.startsWith('http')) return

      // URL 去重（基于 origin + pathname）
      const dedupeKey = this.getDedupeKey(url)
      if (seenUrls.has(dedupeKey)) return
      seenUrls.add(dedupeKey)

      // 提取搜索引擎给出的 snippet 摘要
      let snippet = ''
      if (input.snippetSelector) {
        snippet = $el.find(input.snippetSelector).first().text().trim()
      }

      results.push({
        title,
        url,
        content: '', // 正文由后续 fetchContent 获取
        snippet: snippet || undefined
      })
    })

    if (results.length === 0) {
      // 0 结果时输出 HTML 片段，帮助诊断选择器是否失效
      const bodySnippet = $('body').text().trim().slice(0, 300)
      console.warn(
        `[SearchWindow] 选择器 "${input.resultSelector}" 未匹配到任何结果。` +
        `页面前 300 字符: ${bodySnippet}`
      )
    } else {
      console.debug(`[SearchWindow] 解析完成: ${results.length} 条结果`)
    }

    return results
  }

  /**
   * 获取单个页面的正文内容
   *
   * 使用 Electron net.fetch 发起轻量 HTTP 请求获取 HTML，
   * 然后用 cheerio 进行启发式正文提取。
   *
   * 注意：不使用 BrowserWindow，因为并发创建多个 BrowserWindow
   * 会产生多个渲染器进程，可能导致 Electron 进程崩溃。
   * 仅搜索引擎页面（需要 JS 渲染搜索结果）才使用 BrowserWindow。
   */
  async fetchContent(input: {
    url: string
    timeoutMs: number
    maxLength: number
  }): Promise<{ content: string; title?: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), input.timeoutMs)

    try {
      const response = await net.fetch(input.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      })

      if (!response.ok) {
        return { content: '' }
      }

      const html = await response.text()
      return this.extractContent(html, input.maxLength)
    } catch {
      // 超时、网络错误等，返回空内容（不影响搜索结果）
      return { content: '' }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * URL 去重 key：origin + pathname + search（保留 query 参数以区分不同页面）
   *
   * 仅忽略 fragment（#hash），因为 query 参数可能是页面身份的一部分
   * （如 YouTube ?v=xxx、Google ?q=xxx 等）。
   */
  private getDedupeKey(url: string): string {
    try {
      const parsed = new URL(url)
      // 去掉尾部斜杠统一格式，保留 search 参数
      const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
      return `${parsed.origin}${pathname}${parsed.search}`.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  }

  /**
   * 从 HTML 中启发式提取正文内容
   *
   * 策略：
   * 1. 移除 script/style/nav 等噪声标签
   * 2. 优先取 article/main 等语义区块
   * 3. 回退到 body 全文
   * 4. 清理连续空白，截断到 maxLength
   */
  private extractContent(html: string, maxLength: number): { content: string; title?: string } {
    const $ = cheerio.load(html)

    // 提取 title
    const title = $('title').text().trim() || undefined

    // 移除噪声标签
    for (const tag of NOISE_TAGS) {
      $(tag).remove()
    }

    // 优先从语义容器提取
    let contentText = ''
    for (const selector of CONTENT_SELECTORS) {
      const $container = $(selector).first()
      if ($container.length > 0) {
        contentText = $container.text().trim()
        if (contentText.length > 100) break // 内容足够丰富则停止
      }
    }

    // 回退到 body
    if (contentText.length < 100) {
      contentText = $('body').text().trim()
    }

    // 清理连续空白和空行
    contentText = contentText
      .replace(/\t/g, ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    // 截断到 maxLength
    if (contentText.length > maxLength) {
      contentText = contentText.slice(0, maxLength)
    }

    return { content: contentText, title }
  }

  /**
   * 通过 net.fetch 获取静态 HTML（不创建 BrowserWindow）
   *
   * 适用于不需要 JS 渲染的搜索引擎页面（如 DuckDuckGo HTML 版），
   * 避免创建额外的渲染器进程，速度更快、资源开销更低。
   */
  private async fetchStaticHtml(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await net.fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.text()
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 通过隐藏 BrowserWindow 加载 URL 并返回渲染后的完整 HTML
   *
   * 使用固定的搜索专用 session，Cookie 在搜索间持久化。
   * 这是必须的 — Bing 等搜索引擎面对无 Cookie 的「全新浏览器」会返回
   * 同意页 / CAPTCHA / 首次访问版本，导致选择器匹配不到结果。
   */
  private async fetchRenderedHtml(url: string, timeoutMs: number): Promise<string> {
    const { session } = await import('electron')
    // 使用固定 partition 隔离搜索流量和主应用，同时保持搜索间 Cookie 持久化
    const ses = session.fromPartition('persist:search')

    const win = new BrowserWindow({
      width: 1280,
      height: 768,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: ses,
        devTools: !app.isPackaged
      }
    })

    // 伪装浏览器 User-Agent，避免被搜索引擎拦截
    win.webContents.userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

    try {
      // loadURL 内部等待 did-finish-load；加超时保护防止页面永久挂起
      await Promise.race([
        win.loadURL(url),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('本地搜索页面加载超时')), timeoutMs)
        )
      ])

      // 短暂延迟确保动态 JS 执行完毕
      await new Promise<void>((resolve) => setTimeout(resolve, 800))

      // 获取渲染后的 HTML
      const html: string = await win.webContents.executeJavaScript(
        'document.documentElement.outerHTML'
      )

      return html
    } finally {
      // 确保窗口释放
      if (!win.isDestroyed()) {
        win.close()
      }
    }
  }
}
