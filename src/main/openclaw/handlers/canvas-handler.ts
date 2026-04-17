/**
 * Canvas 命令处理器
 *
 * 实现 OpenClaw Canvas 系列命令：
 * - canvas.snapshot: 截取当前屏幕截图
 * - canvas.present: 在新窗口中展示 URL
 * - canvas.eval: 在 Canvas 窗口中执行 JavaScript
 *
 * 通过依赖注入复用 Mulby 已有的 screen capture 和 BrowserWindow 能力。
 */

import { BrowserWindow } from 'electron'
import { pluginScreen } from '../../../main/plugin/screen'
import type { CommandHandler } from '../command-registry'
import { registerSystemInternalWindow, unregisterSystemInternalWindow } from '../../services/ipc-caller-resolver'

/** Canvas 窗口管理器（简易实现，后续可扩展） */
const canvasWindows = new Map<string, BrowserWindow>()

/** 所需的外部依赖注入 */
export interface CanvasHandlerDeps {
  /** 获取主窗口（用作 canvas.present 窗口的 parent） */
  getMainWindow: () => BrowserWindow | null
}

/**
 * 创建 Canvas 命令处理器
 */
export function createCanvasHandlers(_deps: CanvasHandlerDeps): Record<string, { handler: CommandHandler; cap: string; description: string }> {
  return {
    'canvas.snapshot': {
      cap: 'canvas',
      description: '截取 Mulby 所在屏幕的截图',
      handler: async (params) => {
        const format = (params.format as 'png' | 'jpeg') || 'png'
        const quality = typeof params.quality === 'number' ? params.quality : 90

        try {
          // 使用 pluginScreen 截图（内置原生模块优先 + desktopCapturer fallback）
          const buffer = await pluginScreen.captureScreen({ format, quality })

          return {
            format,
            base64: buffer.toString('base64')
          }
        } catch (err) {
          throw new Error(`截屏失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    },

    'canvas.present': {
      cap: 'canvas',
      description: '在新窗口中展示指定 URL 内容',
      handler: async (params) => {
        const url = String(params.url || '').trim()
        if (!url) throw new Error('url is required')

        const width = typeof params.width === 'number' ? params.width : 800
        const height = typeof params.height === 'number' ? params.height : 600
        const title = String(params.title || 'OpenClaw Canvas')
        const windowId = String(params.windowId || `canvas-${Date.now()}`)

        // 如果已有同 ID 窗口，先关闭
        const existing = canvasWindows.get(windowId)
        if (existing && !existing.isDestroyed()) {
          existing.close()
        }

        const win = new BrowserWindow({
          width,
          height,
          title,
          show: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          }
        })

        registerSystemInternalWindow(win.id)
        canvasWindows.set(windowId, win)
        win.on('closed', () => {
          unregisterSystemInternalWindow(win.id)
          canvasWindows.delete(windowId)
        })

        await win.loadURL(url)

        return {
          windowId,
          url,
          width,
          height
        }
      }
    },

    'canvas.eval': {
      cap: 'canvas',
      description: '在 Canvas 窗口中执行 JavaScript 代码',
      handler: async (params) => {
        const windowId = String(params.windowId || '').trim()
        if (!windowId) throw new Error('windowId is required')

        const code = String(params.code || '').trim()
        if (!code) throw new Error('code is required')

        const win = canvasWindows.get(windowId)
        if (!win || win.isDestroyed()) {
          throw new Error(`Canvas 窗口 ${windowId} 不存在或已关闭`)
        }

        try {
          const result = await win.webContents.executeJavaScript(code)
          return { result }
        } catch (err) {
          throw new Error(`JavaScript 执行失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }
}
