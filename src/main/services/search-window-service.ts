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
import { BrowserWindow, app } from 'electron'
import * as cheerio from 'cheerio'
import type { LocalSearchExecutor, WebSearchResult } from '../ai/tools/web-search-service'

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

const URL_DECODERS: Record<string, (url: string) => string> = {
  'bing-redirect': decodeBingRedirectUrl
}

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
    urlDecoder?: string
    maxResults: number
    timeoutMs: number
  }): Promise<WebSearchResult[]> {
    const searchUrl = input.urlTemplate.replace(
      /%s/g,
      encodeURIComponent(input.query)
    )

    // 1. 获取渲染后的 HTML
    const html = await this.fetchRenderedHtml(searchUrl, input.timeoutMs)

    // 2. 用 cheerio 解析搜索结果
    const $ = cheerio.load(html)
    const urlDecoder = input.urlDecoder ? URL_DECODERS[input.urlDecoder] : undefined
    const results: WebSearchResult[] = []

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

      results.push({
        title,
        url,
        content: '' // 本地搜索只获取标题和链接，内容由后续 web_fetch 获取
      })
    })

    return results
  }

  /**
   * 通过隐藏 BrowserWindow 加载 URL 并返回渲染后的完整 HTML
   */
  private async fetchRenderedHtml(url: string, timeoutMs: number): Promise<string> {
    const win = new BrowserWindow({
      width: 1280,
      height: 768,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        devTools: !app.isPackaged
      }
    })

    // 伪装浏览器 User-Agent，避免被搜索引擎拦截
    win.webContents.userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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
