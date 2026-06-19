import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { InputPayload, Plugin } from '../../shared/types/plugin'
import { getPluginPreloadPath } from '../plugin/plugin-preload-wrapper'
import {
  getPluginRendererCapabilities,
  getPluginRendererWebPreferences,
  installPluginWebviewSecurity,
  PLUGIN_RENDERER_V8_CACHE_OPTIONS
} from '../plugin/plugin-web-preferences'

/**
 * 离屏渲染插件 UI 做冒烟验证（Tier 2）。
 *
 * 关键：复用同一个隐藏 BrowserWindow / renderer，按需重新导航（loadFile）。
 * 反复「创建+销毁」离屏窗口在 Windows 上会卡住第二个 renderer 的启动（dom-ready 不触发，
 * 连定时器都不再触发），因此采用「渲染一次、复用」的会话模型：同一插件复用窗口，切换插件才重建。
 *
 * 说明：插件 UI 挂载时常通过 window.mulby.* 调用 IPC（theme/settings/storage 等）。
 * 调用方应先 ensureAutomationIpcHandlers() 注册常用处理器；未注册渠道产生的
 * 「No handler registered」会被降级到 missingBridge（非致命），与插件自身错误区分。
 */

export interface UiRenderResult {
  rendered: boolean
  domReady: boolean
  loadFailed?: { code: number; description: string }
  renderProcessGone?: { reason: string; exitCode: number }
  /** 插件自身的 console.error（真实问题） */
  consoleErrors: string[]
  /** 被降级的「No handler registered」类宿主桥缺失提示（非致命） */
  missingBridge: string[]
  screenshotBytes?: number
  screenshotPng?: Buffer
  domSummary?: unknown
}

export interface UiRenderOptions {
  featureCode: string
  input?: InputPayload
  route?: string
  timeoutMs?: number
  graceMs?: number
  wantScreenshot?: boolean
  /** 自定义 DOM 查询 JS（返回值需 JSON 可序列化）；缺省返回页面概要 */
  domQueryJs?: string
}

const RENDER_DEBUG = process.env.MULBY_VERIFY_MCP_DEBUG === '1'
const rdbg = (m: string): void => {
  if (RENDER_DEBUG) {
    try {
      process.stderr.write(`[render] ${m}\n`)
    } catch {
      /* ignore */
    }
  }
}

const MISSING_HANDLER_RE = /No handler registered/i
const DEFAULT_DOM_SUMMARY_JS =
  '({ title: document.title, bodyChars: (document.body && document.body.innerText ? document.body.innerText.length : 0), rootChildCount: document.body ? document.body.childElementCount : 0 })'

/**
 * 可复用的插件 UI 离屏渲染器。一个实例维护至多一个隐藏窗口；同一插件复用，切换插件重建。
 * 用完调用 destroy()。
 */
export class PluginUiRenderer {
  private win: BrowserWindow | null = null
  private currentPluginId: string | null = null
  private consoleErrors: string[] = []
  private missingBridge: string[] = []

  private ensureWindow(plugin: Plugin): BrowserWindow {
    if (this.win && !this.win.isDestroyed() && this.currentPluginId === plugin.id) {
      return this.win
    }
    this.destroy()

    const basePreloadPath = join(__dirname, '../preload/index.js')
    const preloadPath = getPluginPreloadPath(basePreloadPath, plugin)
    const hasCustomPreload = !!plugin.manifest.preload

    const win = new BrowserWindow({
      width: 800,
      height: 600,
      x: -32000,
      y: -32000,
      show: false,
      frame: false,
      skipTaskbar: true,
      webPreferences: {
        preload: preloadPath,
        additionalArguments: ['--mulby-plugin-window'],
        contextIsolation: !hasCustomPreload,
        nodeIntegration: hasCustomPreload,
        sandbox: !hasCustomPreload,
        backgroundThrottling: false,
        v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS,
        ...getPluginRendererWebPreferences(plugin)
      }
    })
    installPluginWebviewSecurity(win.webContents, plugin)
    // 持久 console 监听：错误推入实例缓冲，每次 render 开始时清空
    win.webContents.on('console-message', (_event, level, message, _line, _sourceId) => {
      if (level !== 3 || typeof message !== 'string') return
      if (MISSING_HANDLER_RE.test(message)) this.missingBridge.push(message)
      else this.consoleErrors.push(message)
    })
    this.win = win
    this.currentPluginId = plugin.id
    return win
  }

  async render(plugin: Plugin, options: UiRenderOptions): Promise<UiRenderResult> {
    const result: UiRenderResult = { rendered: false, domReady: false, consoleErrors: [], missingBridge: [] }

    const uiRel = plugin.manifest.ui
    if (!uiRel) {
      result.consoleErrors.push('plugin 未声明 manifest.ui')
      return result
    }
    const uiPath = join(plugin.path, uiRel)
    if (!existsSync(uiPath)) {
      result.loadFailed = { code: -6, description: `UI 文件不存在: ${uiRel}` }
      return result
    }

    const win = this.ensureWindow(plugin)
    const wc = win.webContents
    this.consoleErrors = []
    this.missingBridge = []
    const timeoutMs = options.timeoutMs ?? 5000
    const graceMs = options.graceMs ?? 800

    // 清掉上一次 render 残留的 once 监听：成功渲染时 did-fail-load / render-process-gone 不会触发，
    // 在复用的 webContents 上会无限累积。（不影响 ensureWindow 里注册的 console-message 监听。）
    wc.removeAllListeners('dom-ready')
    wc.removeAllListeners('did-finish-load')
    wc.removeAllListeners('did-fail-load')
    wc.removeAllListeners('render-process-gone')

    let settled = false
    const readyPromise = new Promise<void>((resolve, reject) => {
      const succeed = (): void => {
        if (!settled) {
          settled = true
          resolve()
        }
      }
      wc.once('dom-ready', () => {
        result.domReady = true
        succeed()
      })
      wc.once('did-finish-load', succeed)
      wc.once('did-fail-load', (_e, code: number, description: string, _url: string, isMainFrame: boolean) => {
        if (isMainFrame && !settled) {
          settled = true
          result.loadFailed = { code, description }
          reject(new Error(`load failed: ${description} (${code})`))
        }
      })
      wc.once('render-process-gone', (_e, details) => {
        if (!settled) {
          settled = true
          result.renderProcessGone = { reason: details.reason, exitCode: details.exitCode ?? 0 }
          reject(new Error(`render process gone: ${details.reason}`))
        }
      })
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        rdbg('timeout fired')
        reject(new Error(`render timeout ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      rdbg(`loadFile ${uiPath}`)
      if (options.route) void wc.loadFile(uiPath, { hash: options.route })
      else void wc.loadFile(uiPath)

      await Promise.race([readyPromise, timeoutPromise])
      rdbg(`ready domReady=${result.domReady}`)
      result.rendered = true

      if (!wc.isDestroyed()) {
        wc.send('plugin:init', {
          pluginName: plugin.id,
          featureCode: options.featureCode,
          input: options.input?.text ?? '',
          attachments: options.input?.attachments ?? [],
          mode: 'detached',
          route: options.route,
          capabilities: getPluginRendererCapabilities(plugin),
          nonce: Date.now()
        })
      }

      await new Promise((r) => setTimeout(r, graceMs))

      if (options.wantScreenshot && this.win && !this.win.isDestroyed()) {
        try {
          // 隐藏窗口不会被合成器出帧，capturePage 会挂起。showInactive（远离屏幕、不抢焦点）使其参与合成。
          if (!this.win.isVisible()) {
            this.win.setPosition(-32000, -32000)
            this.win.showInactive()
            await new Promise((r) => setTimeout(r, 150))
          }
          const png = await Promise.race([
            wc.capturePage().then((image) => image.toPNG()),
            new Promise<Buffer | null>((resolve) => setTimeout(() => resolve(null), 4000))
          ])
          if (png) {
            result.screenshotPng = png
            result.screenshotBytes = png.length
          }
          // 截图后重新隐藏，避免离屏窗口持续可见占用资源
          if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
            this.win.hide()
          }
        } catch {
          /* 截图失败不致命 */
        }
      }

      if (!wc.isDestroyed()) {
        try {
          rdbg('execJs start')
          // 自定义 domQueryJs 可能含死循环；加超时兜底，避免挂死整个验证 / MCP server
          result.domSummary = await Promise.race([
            wc.executeJavaScript(options.domQueryJs ?? DEFAULT_DOM_SUMMARY_JS),
            new Promise<unknown>((resolve) => setTimeout(() => resolve('[domQuery 超时]'), 3000))
          ])
          rdbg('execJs done')
        } catch {
          /* DOM 查询失败不致命 */
        }
      }
    } catch (err) {
      rdbg(`catch ${err instanceof Error ? err.message : String(err)}`)
      if (!result.loadFailed && !result.renderProcessGone) {
        this.consoleErrors.push(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (timer) clearTimeout(timer)
    }

    result.consoleErrors = [...this.consoleErrors]
    result.missingBridge = [...this.missingBridge]
    rdbg(`returning rendered=${result.rendered}`)
    return result
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) {
      try {
        this.win.destroy()
      } catch {
        /* ignore */
      }
    }
    this.win = null
    this.currentPluginId = null
  }
}
