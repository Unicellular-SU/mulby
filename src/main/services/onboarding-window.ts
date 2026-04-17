import { BrowserWindow, app, screen } from 'electron'
import { join } from 'path'
import http from 'http'
import https from 'https'
import { ThemeManager } from './theme'
import { attachShortcutRecordingGuard } from './shortcut-recording-guard'
import {
  shouldUseWindowsFramelessSurface,
  applyWindowsFramelessSurface
} from './window-surface'
import { registerAppWindow, unregisterAppWindow } from './ipc-caller-resolver'

const ONBOARDING_WIDTH = 720
const ONBOARDING_HEIGHT = 520

function canReachUrl(url: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url)
      const requester = parsed.protocol === 'https:' ? https : http
      const req = requester.request(
        {
          method: 'GET',
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname || '/',
          timeout: timeoutMs
        },
        () => resolve(true)
      )
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.end()
    } catch {
      resolve(false)
    }
  })
}

export class OnboardingWindowManager {
  private window: BrowserWindow | null = null
  private themeManager: ThemeManager | null = null
  private onCompleteCallback: (() => void) | null = null
  private completed = false

  setThemeManager(manager: ThemeManager): void {
    this.themeManager = manager
  }

  onComplete(callback: () => void): void {
    this.onCompleteCallback = callback
  }

  /** 被 IPC handler onboarding:complete 调用，标记引导完成 */
  markCompleted(): void {
    this.completed = true
  }

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  async show(): Promise<void> {
    if (this.isOpen()) {
      this.window!.focus()
      return
    }

    this.completed = false

    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    const { width: screenWidth, height: screenHeight } = display.workAreaSize
    const { x: screenX, y: screenY } = display.workArea
    const x = screenX + Math.round((screenWidth - ONBOARDING_WIDTH) / 2)
    const y = screenY + Math.round((screenHeight - ONBOARDING_HEIGHT) / 2)

    const currentTheme = this.themeManager?.getActualTheme() || 'dark'
    const useWindowsFramelessSurface = shouldUseWindowsFramelessSurface()
    const backgroundColor = useWindowsFramelessSurface
      ? '#00000000'
      : (currentTheme === 'dark' ? '#0F172A' : '#ffffff')

    this.window = new BrowserWindow({
      width: ONBOARDING_WIDTH,
      height: ONBOARDING_HEIGHT,
      x,
      y,
      frame: false,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor,
      transparent: useWindowsFramelessSurface,
      hasShadow: true,
      roundedCorners: true,
      title: 'Mulby - 欢迎',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    registerAppWindow(this.window.id)
    attachShortcutRecordingGuard(this.window)

    this.window.once('ready-to-show', async () => {
      if (!this.window || this.window.isDestroyed()) return
      if (useWindowsFramelessSurface) {
        await applyWindowsFramelessSurface(this.window, { resizeMode: 'none' })
        if (!this.window || this.window.isDestroyed()) return
      }
      this.window.show()
      this.window.focus()
    })

    this.window.on('closed', () => {
      if (this.window) unregisterAppWindow(this.window.id)
      this.window = null
      if (this.completed) {
        this.onCompleteCallback?.()
      }
    })

    // 注册主题管理
    if (this.themeManager) {
      this.themeManager.registerWindow(this.window)
    }

    // 禁止 ESC 关闭（通过渲染进程处理）
    this.window.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') {
        _event.preventDefault()
      }
    })

    await this.loadContent()
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close()
    }
    this.window = null
  }

  private async loadContent(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return

    const onboardingUrl = '?mulbyOnboarding=1'

    if (process.env.VITE_DEV_SERVER_URL) {
      const devUrl = process.env.VITE_DEV_SERVER_URL
      const reachable = await canReachUrl(devUrl)
      if (reachable) {
        await this.window.loadURL(`${devUrl}${onboardingUrl}`)
        return
      }
    }

    const isDevEnv = !app.isPackaged || process.env.NODE_ENV === 'development' || !process.env.NODE_ENV
    if (isDevEnv) {
      const devUrl = 'http://localhost:5173'
      const reachable = await canReachUrl(devUrl)
      if (reachable) {
        await this.window.loadURL(`${devUrl}${onboardingUrl}`)
        return
      }
    }

    await this.window.loadFile(join(__dirname, '../renderer/index.html'), {
      search: 'mulbyOnboarding=1'
    })
  }
}
