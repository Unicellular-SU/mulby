/**
 * 搜索窗口服务 — 管理隐藏 BrowserWindow 实现本地搜索引擎爬取
 *
 * 架构设计（参考 Cherry Studio 并改进）：
 * - 搜索结果解析和正文提取全部委派给 Parser Worker（隐藏 Renderer 进程）
 * - Parser Worker 通过 @mozilla/readability + turndown 实现高质量正文提取
 * - 主进程仅负责网络请求和窗口管理，不再进行任何 DOM 解析（零 Cheerio）
 * - 比 Cherry Studio 更优：Parser Worker 独立于 UI，即使主窗口关闭也能后台搜索
 *
 * 实现 LocalSearchExecutor 接口，注入到 WebSearchService 中。
 */
import { BrowserWindow, app, ipcMain, net, session } from 'electron'
import { join } from 'node:path'
import type { LocalSearchExecutor, WebSearchResult } from '../ai/tools/web-search'

// ==================== Parser Worker 管理 ====================

/** Parser Worker 单例 — 持久化的隐藏 BrowserWindow */
let parserWorker: BrowserWindow | null = null
let parserReady = false
let parserReadyResolve: (() => void) | null = null
/** 可变的就绪 promise — ensureParserWorker 重建时会同步更新此引用 */
let parserReadyPromise = new Promise<void>((resolve) => {
  parserReadyResolve = resolve
})

/** ipcMain 监听器是否已注册（懒注册，避免非 Electron 环境 import 崩溃） */
let ipcListenerRegistered = false

/**
 * 懒注册 ipcMain 监听器 — 仅在 Electron 主进程环境首次调用时注册
 *
 * 避免在模块顶层执行 ipcMain.on()，因为在 Node 测试环境中 ipcMain 未定义。
 */
function ensureIpcListener(): void {
  if (ipcListenerRegistered) return
  ipcListenerRegistered = true

  ipcMain.on('web-parser:ready', () => {
    parserReady = true
    if (parserReadyResolve) {
      parserReadyResolve()
      parserReadyResolve = null
    }
    console.debug('[SearchWindow] Parser Worker 已就绪')
  })
}

/**
 * 初始化 Parser Worker
 *
 * 创建一个极轻量的隐藏 BrowserWindow，加载 web-parser preload 脚本。
 * 该窗口不加载任何页面，仅作为前端 DOM API 的执行环境。
 */
function ensureParserWorker(): BrowserWindow {
  // 懒注册 ipcMain 监听器（确保在 Electron 主进程中才注册）
  ensureIpcListener()

  if (parserWorker && !parserWorker.isDestroyed()) {
    return parserWorker
  }

  // 重建时必须同步更新 parserReadyPromise 引用，
  // 确保 withParserWorker() 等待的是新 promise 而非已废弃的旧 promise
  parserReady = false
  parserReadyPromise = new Promise<void>((resolve) => {
    parserReadyResolve = resolve
  })

  parserWorker = new BrowserWindow({
    width: 0,
    height: 0,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/web-parser.js'),
      // 隔离 session，不影响主应用
      partition: 'persist:web-parser'
    }
  })

  // 加载空白页以触发 preload 执行
  parserWorker.loadURL('about:blank')

  parserWorker.on('closed', () => {
    parserWorker = null
    parserReady = false
  })

  return parserWorker
}

/**
 * 等待 Parser Worker 就绪后执行解析任务
 */
async function withParserWorker<T>(fn: (worker: BrowserWindow) => Promise<T>): Promise<T> {
  const worker = ensureParserWorker()

  // 等待 preload 加载完成（首次约 200ms，后续瞬间）
  if (!parserReady) {
    await Promise.race([
      parserReadyPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Parser Worker 启动超时')), 10_000)
      )
    ])
  }

  return fn(worker)
}

// ==================== 反检测常量 ====================

/** 伪装的 Edge 版本号（需与 search-stealth.ts 中保持一致） */
const EDGE_VERSION = '136'

const SPOOFED_UA =
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_VERSION}.0.0.0`

// ==================== 搜索窗口服务 ====================

export class SearchWindowService implements LocalSearchExecutor {
  private static instance: SearchWindowService | null = null
  /** 已完成 Cookie 预热的 host 集合（按域名隔离，避免 Bing 预热阻塞 Google 等引擎） */
  private warmedHosts = new Set<string>()
  /** 搜索 session 的 webRequest 拦截器是否已注册 */
  private searchSessionConfigured = false

  static getInstance(): SearchWindowService {
    if (!SearchWindowService.instance) {
      SearchWindowService.instance = new SearchWindowService()
    }
    return SearchWindowService.instance
  }

  constructor() {
    // 预热 Parser Worker（app ready 后立即创建）
    if (app.isReady()) {
      ensureParserWorker()
    } else {
      app.once('ready', () => ensureParserWorker())
    }
  }

  /**
   * 配置搜索专用 session 的请求头拦截器（仅执行一次）
   *
   * 使用 webRequest.onBeforeSendHeaders 替代 loadURL extraHeaders，
   * 确保所有请求（包括页面内 XHR/子资源）的 UA 和 Client Hints 一致。
   */
  private configureSearchSession(ses: Electron.Session): void {
    if (this.searchSessionConfigured) return
    this.searchSessionConfigured = true

    ses.setUserAgent(SPOOFED_UA)

    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders }
      headers['User-Agent'] = SPOOFED_UA
      headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7'
      headers['Sec-Ch-Ua'] = `"Chromium";v="${EDGE_VERSION}", "Microsoft Edge";v="${EDGE_VERSION}", "Not.A/Brand";v="99"`
      headers['Sec-Ch-Ua-Mobile'] = '?0'
      headers['Sec-Ch-Ua-Platform'] = '"macOS"'
      callback({ requestHeaders: headers })
    })

    console.debug('[SearchWindow] 搜索 session 请求头拦截器已注册')
  }

  /** Bing 域名集合 — 仅对这些域名执行 Cookie 预热 */
  private static readonly BING_HOSTS = new Set(['bing.com', 'cn.bing.com', 'www.bing.com'])

  /**
   * Cookie 预热 — 首次搜索前先访问目标搜索引擎首页获取会话 Cookie
   *
   * 全新 session 直接发起搜索请求是典型的机器人行为特征。
   * 预热后，后续搜索请求会自动携带 Cookie（persist:search partition 持久化）。
   *
   * 仅对 Bing 域名执行预热（Bing 对 Cookie 缺失特别敏感），
   * 其他引擎（Google 等）不需要此步骤。
   */
  private async warmSearchSession(ses: Electron.Session, targetUrl: string, timeoutMs: number): Promise<void> {
    let targetHost: string
    try {
      targetHost = new URL(targetUrl).hostname
    } catch {
      return // URL 解析失败，跳过预热
    }

    // 仅对 Bing 域名执行预热
    if (!SearchWindowService.BING_HOSTS.has(targetHost)) return
    // 该 host 已预热过，跳过
    if (this.warmedHosts.has(targetHost)) return

    const warmUrl = `https://${targetHost}/`
    const win = new BrowserWindow({
      width: 1280,
      height: 768,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
        preload: join(__dirname, '../preload/search-stealth.js'),
        session: ses,
      }
    })

    try {
      await Promise.race([
        win.loadURL(warmUrl),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Session 预热超时')), Math.min(timeoutMs, 10_000))
        )
      ])
      // 等待首页 JS 执行，确保 Cookie 被完整设置
      await new Promise<void>((r) => setTimeout(r, 1000))
      console.debug(`[SearchWindow] 搜索 session Cookie 预热完成: ${targetHost}`)
    } catch (err) {
      console.warn(`[SearchWindow] Session 预热失败（${targetHost}，不影响后续搜索）:`, err)
    } finally {
      // 无论成功/失败都标记为已预热，避免对不可达的 host 反复重试导致每次搜索延 10s
      this.warmedHosts.add(targetHost)
      if (!win.isDestroyed()) win.close()
    }
  }

  /**
   * 通过隐藏 BrowserWindow 加载搜索 URL，然后委派 Parser Worker 解析 HTML
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
    const searchUrl = input.urlTemplate.replace(/%s/g, encodeURIComponent(query))
    console.debug(`[SearchWindow] 搜索: "${query}" → ${searchUrl}`)

    // DuckDuckGo HTML 版不需要 JS 渲染，用轻量 HTTP 请求替代 BrowserWindow
    const html = searchUrl.includes('html.duckduckgo.com')
      ? await this.fetchStaticHtml(searchUrl, input.timeoutMs)
      : await this.fetchRenderedHtml(searchUrl, input.timeoutMs)

    // 委派给 Parser Worker 解析搜索结果（前端原生 DOMParser）
    const parsed = await withParserWorker(async (worker) => {
      return worker.webContents.executeJavaScript(`
        window.webParser.parseSearchResults(${JSON.stringify({
          html,
          resultSelector: input.resultSelector,
          titleSelector: input.titleSelector,
          linkSelector: input.linkSelector,
          snippetSelector: input.snippetSelector,
          urlDecoder: input.urlDecoder,
          maxResults: input.maxResults
        })})
      `)
    })

    const results: WebSearchResult[] = (parsed || []).map((item: any) => ({
      title: String(item.title || ''),
      url: String(item.url || ''),
      content: '', // 正文由后续 fetchContent 获取
      snippet: item.snippet ? String(item.snippet) : undefined
    }))

    if (results.length === 0) {
      console.warn(`[SearchWindow] 选择器 "${input.resultSelector}" 未匹配到任何结果`)
    } else {
      console.debug(`[SearchWindow] 解析完成: ${results.length} 条结果`)
    }

    return results
  }

  /**
   * 获取单个页面的正文内容
   *
   * 使用 Electron net.fetch 发起轻量 HTTP 请求获取 HTML，
   * 然后委派 Parser Worker 使用 Readability + Turndown 提取并转为 Markdown。
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

      // 委派给 Parser Worker 使用 Readability + Turndown 提取正文
      const result = await withParserWorker(async (worker) => {
        return worker.webContents.executeJavaScript(`
          window.webParser.extractContent(${JSON.stringify({
            html,
            maxLength: input.maxLength
          })})
        `)
      })

      return {
        content: result?.content || '',
        title: result?.title || undefined
      }
    } catch {
      // 超时、网络错误等，返回空内容（不影响搜索结果）
      return { content: '' }
    } finally {
      clearTimeout(timer)
    }
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
   * 反检测策略：
   * 1. Preload 脚本（search-stealth.js）— 在页面 JS 之前执行 stealth 补丁
   * 2. session.webRequest.onBeforeSendHeaders — 统一所有请求的 UA 和 Client Hints
   * 3. Cookie 持久化（persist:search）+ 首次预热 — 消除"全新浏览器"特征
   */
  private async fetchRenderedHtml(url: string, timeoutMs: number): Promise<string> {
    // 使用固定 partition 隔离搜索流量和主应用，同时保持搜索间 Cookie 持久化
    const ses = session.fromPartition('persist:search')

    // 配置 session 级请求头拦截（仅首次）
    this.configureSearchSession(ses)

    // Cookie 预热 — 仅对 Bing 域名首次搜索前获取 MUID 等会话标识
    await this.warmSearchSession(ses, url, timeoutMs)

    const win = new BrowserWindow({
      width: 1280,
      height: 768,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        // contextIsolation: false 使 preload 运行在页面主世界，
        // 确保 stealth 补丁在搜索引擎 JS 之前生效。
        // 安全性：该窗口隐藏且仅加载搜索引擎，nodeIntegration: false，无风险。
        contextIsolation: false,
        preload: join(__dirname, '../preload/search-stealth.js'),
        session: ses,
        devTools: !app.isPackaged
      }
    })

    try {
      // Sec-Fetch-* 仅用于主导航请求（子资源由 Chromium 自动生成正确值）
      const extraHeaders = [
        'Sec-Fetch-Dest: document',
        'Sec-Fetch-Mode: navigate',
        'Sec-Fetch-Site: none',
        'Sec-Fetch-User: ?1',
        'Upgrade-Insecure-Requests: 1'
      ].join('\n')

      await Promise.race([
        win.loadURL(url, { extraHeaders: extraHeaders + '\n' }),
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
      if (!win.isDestroyed()) {
        win.close()
      }
    }
  }
}
