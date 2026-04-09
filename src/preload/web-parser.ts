/**
 * Web Parser Worker — preload 脚本
 *
 * 在隐藏的 BrowserWindow 中运行，通过 contextBridge 暴露前端原生 DOM 解析能力：
 * 1. parseSearchResults — 从搜索引擎 HTML 提取结构化搜索结果
 * 2. extractContent    — 使用 @mozilla/readability + turndown 把网页转为干净 Markdown
 *
 * 设计思路：
 * - 利用 Renderer 进程的原生 DOMParser，避免在主进程中引入 Cheerio 阻塞主线程
 * - Readability 是 Firefox 阅读模式的核心引擎，正文提取质量远超启发式选择器
 * - Turndown 将 HTML 优雅地转为 Markdown，完美匹配大模型的输入格式
 */
import { contextBridge, ipcRenderer } from 'electron'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
})

// ==================== 搜索结果解析 ====================

interface ParseSearchResultsInput {
  html: string
  resultSelector: string
  titleSelector: string
  linkSelector: string
  snippetSelector?: string
  urlDecoder?: string
  maxResults: number
}

interface ParsedSearchResult {
  title: string
  url: string
  snippet?: string
}

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
    const decoded = atob(base64Part)
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

/**
 * 使用浏览器原生 DOMParser 解析搜索引擎 HTML，提取搜索结果列表
 */
function parseSearchResults(input: ParseSearchResultsInput): ParsedSearchResult[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(input.html, 'text/html')

  const urlDecoder = input.urlDecoder ? URL_DECODERS[input.urlDecoder] : undefined
  const results: ParsedSearchResult[] = []
  const seenUrls = new Set<string>()

  const elements = doc.querySelectorAll(input.resultSelector)

  for (const el of elements) {
    if (results.length >= input.maxResults) break

    const titleEl = el.querySelector(input.titleSelector)
    const linkEl = el.querySelector(input.linkSelector)

    const title = titleEl?.textContent?.trim() || ''
    let url = linkEl?.getAttribute('href') || ''

    if (!url || !title) continue

    // 应用 URL 解码策略
    if (urlDecoder && url) {
      url = urlDecoder(url)
    }

    // 过滤非 HTTP 链接
    if (!url.startsWith('http')) continue

    // URL 去重（基于 origin + pathname + search）
    try {
      const parsed = new URL(url)
      const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
      const dedupeKey = `${parsed.origin}${pathname}${parsed.search}`.toLowerCase()
      if (seenUrls.has(dedupeKey)) continue
      seenUrls.add(dedupeKey)
    } catch {
      // URL 解析失败跳过
      continue
    }

    // 提取搜索引擎 snippet
    let snippet = ''
    if (input.snippetSelector) {
      snippet = el.querySelector(input.snippetSelector)?.textContent?.trim() || ''
    }

    results.push({
      title,
      url,
      snippet: snippet || undefined
    })
  }

  return results
}

// ==================== 正文提取 ====================

interface ExtractContentInput {
  html: string
  maxLength: number
}

interface ExtractContentResult {
  title: string
  content: string
  truncated: boolean
}

/**
 * 使用 @mozilla/readability 提取正文，然后用 turndown 转为 Markdown
 *
 * Readability 是 Firefox 浏览器的"阅读模式"核心引擎，
 * 能精准剥离广告、侧边栏、导航等噪音，只保留"真正的文章正文"。
 */
function extractContent(input: ExtractContentInput): ExtractContentResult {
  const parser = new DOMParser()
  const doc = parser.parseFromString(input.html, 'text/html')

  // 提取页面标题
  const pageTitle = doc.title || ''

  // 使用 Readability 提取正文
  const reader = new Readability(doc)
  const article = reader.parse()

  if (!article || !article.content) {
    // Readability 失败时回退到 body 纯文本
    const bodyText = doc.body?.textContent?.trim() || ''
    const cleaned = bodyText
      .replace(/\t/g, ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const truncated = cleaned.length > input.maxLength
    return {
      title: pageTitle,
      content: truncated ? cleaned.slice(0, input.maxLength) : cleaned,
      truncated
    }
  }

  // 将干净的 HTML 转为 Markdown
  let markdown = turndown.turndown(article.content)

  // 清理多余空行
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const truncated = markdown.length > input.maxLength
  if (truncated) {
    markdown = markdown.slice(0, input.maxLength)
  }

  return {
    title: article.title || pageTitle,
    content: markdown || 'No content found',
    truncated
  }
}

// ==================== 暴露 API ====================

contextBridge.exposeInMainWorld('webParser', {
  parseSearchResults,
  extractContent
})

// 通知主进程 parser worker 已就绪
ipcRenderer.send('web-parser:ready')
