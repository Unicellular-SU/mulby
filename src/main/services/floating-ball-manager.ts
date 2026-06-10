import { BrowserWindow, Menu, Notification, app, ipcMain, screen } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import log from 'electron-log'
import type {
  AppSettings,
  FloatingBallCommandTarget,
  FloatingBallGesture,
  FloatingBallPosition,
  FloatingBallSettings
} from '../../shared/types/settings'
import {
  isMulbyIconId,
  normalizeFloatingBallCustomSvg,
  type MulbyIconId
} from '../../shared/floating-ball-icons'
import type { AutoPasteClipboardPayload, FileInfo } from '../../shared/types/electron'
import type { InputPayload } from '../../shared/types/plugin'
import type { AppSettingsManager } from './app-settings'
import type { PluginManager } from '../plugin'
import type { ThemeManager } from './theme'
import { PluginInstaller } from '../plugin/installer'
import { captureAutoPasteClipboardPayload } from '../ipc/clipboard'
import { startRegionCapture } from '../plugin/region-capture'
import { getPinnedSize, pinWindowSize, unpinWindowSize, updatePinnedSize } from './window-size-pin'
import {
  buildFloatingBallFilePayload,
  FLOATING_BALL_SHADOW_PADDING,
  getFloatingBallVisualPosition,
  getFloatingBallWindowPosition,
  getFloatingBallWindowSize,
  isFloatingBallPluginPackageDrop,
  normalizeFloatingBallSettings,
  resolveFloatingBallPosition,
  snapFloatingBallPosition,
  type FloatingBallDisplayInfo,
  type FloatingBallFileDropItem
} from './floating-ball-utils'
import mulbyIconV1 from '../../../resources/icons/mulby-v1.svg?raw'
import mulbyIconV2 from '../../../resources/icons/mulby-v2.svg?raw'
import mulbyIconV3 from '../../../resources/icons/mulby-v3.svg?raw'
import mulbyIconV4 from '../../../resources/icons/mulby-v4.svg?raw'
import mulbyIconV5 from '../../../resources/icons/mulby-v5.svg?raw'
import mulbyIconV6 from '../../../resources/icons/mulby-v6.svg?raw'
import mulbyIconV7 from '../../../resources/icons/mulby-v7.svg?raw'
import mulbyIconV8 from '../../../resources/icons/mulby-v8.svg?raw'
import mulbyIconV9 from '../../../resources/icons/mulby-v9.svg?raw'
import mulbyIconV10 from '../../../resources/icons/mulby-v10.svg?raw'

interface FloatingBallManagerOptions {
  settingsManager: AppSettingsManager
  pluginManager: PluginManager
  themeManager: ThemeManager
  getMainWindow: () => BrowserWindow | null
  showMainWindow: (options?: { skipAutoPaste?: boolean }) => void
  toggleMainWindow: () => void
  openFloatingBallSettings: () => void
  quitApp: () => void
}

interface FloatingBallRendererState {
  label: string
  size: number
  opacity: number
  shadowPadding: number
  status: 'idle' | 'busy' | 'success' | 'error'
  theme: 'light' | 'dark'
  iconDataUrl?: string
  message?: string
}

const FLOATING_BALL_STATUS_RESET_MS = 1400
const FLOATING_BALL_PAYLOAD_DELAY_MS = 120
const EMPTY_ACTION_PAYLOAD: InputPayload = { text: '', attachments: [] }
const MULBY_ICON_DATA_URL_BY_ID: Record<MulbyIconId, string> = {
  v1: svgToDataUrl(mulbyIconV1),
  v2: svgToDataUrl(mulbyIconV2),
  v3: svgToDataUrl(mulbyIconV3),
  v4: svgToDataUrl(mulbyIconV4),
  v5: svgToDataUrl(mulbyIconV5),
  v6: svgToDataUrl(mulbyIconV6),
  v7: svgToDataUrl(mulbyIconV7),
  v8: svgToDataUrl(mulbyIconV8),
  v9: svgToDataUrl(mulbyIconV9),
  v10: svgToDataUrl(mulbyIconV10)
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function getFloatingBallIconDataUrl(settings: FloatingBallSettings): string | undefined {
  if (settings.iconId === 'custom') {
    const customSvg = normalizeFloatingBallCustomSvg(settings.customIconSvg)
    return customSvg ? svgToDataUrl(customSvg) : undefined
  }
  if (!isMulbyIconId(settings.iconId)) return undefined
  return MULBY_ICON_DATA_URL_BY_ID[settings.iconId]
}

function dataUrlToPngBuffer(dataUrl: string): Buffer | null {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl)
  if (!match) return null
  try {
    const buffer = Buffer.from(match[1], 'base64')
    return buffer.length > 0 ? buffer : null
  } catch {
    return null
  }
}

function inferMimeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.svg': return 'image/svg+xml'
    case '.bmp': return 'image/bmp'
    case '.txt': return 'text/plain'
    case '.json': return 'application/json'
    case '.pdf': return 'application/pdf'
    default: return ''
  }
}

function notify(body: string, title = app.getName() || 'Mulby'): void {
  try {
    new Notification({ title, body }).show()
  } catch (error) {
    log.warn('[FloatingBall] Failed to show notification:', error)
  }
}

export class FloatingBallManager {
  private window: BrowserWindow | null = null
  private settings: FloatingBallSettings
  private dragOffsetX = 0
  private dragOffsetY = 0
  private status: FloatingBallRendererState['status'] = 'idle'
  private statusTimer: NodeJS.Timeout | null = null
  private readonly installer = new PluginInstaller()

  constructor(private readonly options: FloatingBallManagerOptions) {
    this.settings = normalizeFloatingBallSettings(options.settingsManager.getSettings().floatingBall)
    this.setupIpc()
  }

  init(): void {
    this.applySettings(this.options.settingsManager.getSettings())
  }

  applySettings(appSettings: AppSettings = this.options.settingsManager.getSettings()): void {
    this.settings = normalizeFloatingBallSettings(appSettings.floatingBall)
    if (!this.settings.enabled) {
      this.destroyWindow()
      return
    }
    void this.ensureWindow().then((win) => {
      this.applyWindowSettings(win)
      this.pushState()
    }).catch((error) => {
      log.error('[FloatingBall] Failed to apply settings:', error)
    })
  }

  destroy(): void {
    this.clearStatusTimer()
    this.destroyWindow()
    this.teardownIpc()
  }

  private setupIpc(): void {
    this.teardownIpc()
    ipcMain.handle('floating-ball:getState', () => this.buildRendererState())
    ipcMain.on('floating-ball:click', () => this.handleClick())
    ipcMain.on('floating-ball:doubleClick', () => void this.handleDoubleClick())
    ipcMain.on('floating-ball:longPress', () => void this.executeFloatingBallAction('longPress'))
    ipcMain.on('floating-ball:contextMenu', () => this.showContextMenu())
    ipcMain.on('floating-ball:dragStart', (_event, point: { screenX: number; screenY: number }) => this.handleDragStart(point))
    ipcMain.on('floating-ball:dragging', (_event, point: { screenX: number; screenY: number }) => this.handleDragging(point))
    ipcMain.on('floating-ball:dragEnd', () => this.handleDragEnd())
    ipcMain.on('floating-ball:fileDrop', (_event, files: FloatingBallFileDropItem[]) => void this.handleFileDrop(files))
  }

  private teardownIpc(): void {
    ipcMain.removeHandler('floating-ball:getState')
    for (const channel of [
      'floating-ball:click',
      'floating-ball:doubleClick',
      'floating-ball:longPress',
      'floating-ball:contextMenu',
      'floating-ball:dragStart',
      'floating-ball:dragging',
      'floating-ball:dragEnd',
      'floating-ball:fileDrop'
    ]) {
      ipcMain.removeAllListeners(channel)
    }
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) return this.window

    const size = getFloatingBallWindowSize(this.settings.size)
    const position = getFloatingBallWindowPosition(this.resolvePosition())
    const win = new BrowserWindow({
      width: size,
      height: size,
      x: position.x,
      y: position.y,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      closable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      type: 'panel',
      webPreferences: {
        preload: join(__dirname, '../preload/floating-ball.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })

    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setAlwaysOnTop(true, 'floating')
    } else {
      win.setAlwaysOnTop(true)
    }

    this.options.themeManager.registerWindow(win)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.pinCurrentWindowSize(win)
    win.on('closed', () => {
      unpinWindowSize(win.id)
      if (this.window?.id === win.id) this.window = null
    })

    const devServerUrl = process.env.VITE_DEV_SERVER_URL
    if (devServerUrl) {
      await win.loadURL(new URL('/floating-ball.html', devServerUrl).toString())
    } else {
      await win.loadFile(join(__dirname, '../renderer/floating-ball.html'))
    }

    this.window = win
    this.applyWindowSettings(win)
    win.showInactive()
    return win
  }

  private applyWindowSettings(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    const size = this.settings.size
    const windowSize = getFloatingBallWindowSize(size)
    const current = win.getBounds()
    if (current.width !== windowSize || current.height !== windowSize) {
      win.setBounds({ x: current.x, y: current.y, width: windowSize, height: windowSize }, false)
      updatePinnedSize(win.id, windowSize, windowSize)
    }
    const currentVisualPosition = getFloatingBallVisualPosition({ x: current.x, y: current.y })
    const position = resolveFloatingBallPosition({
      savedPosition: this.settings.position || currentVisualPosition,
      displays: this.getDisplayInfos(),
      size,
      cursorDisplayId: screen.getDisplayNearestPoint(currentVisualPosition).id
    })
    const windowPosition = getFloatingBallWindowPosition(position)
    this.moveWindow(win, windowPosition.x, windowPosition.y)
    win.setOpacity(this.settings.opacity)
  }

  private pinCurrentWindowSize(win: BrowserWindow): void {
    const bounds = win.getBounds()
    pinWindowSize(win.id, bounds.width, bounds.height)
  }

  private moveWindow(win: BrowserWindow, x: number, y: number): void {
    const nextX = Math.round(x)
    const nextY = Math.round(y)
    const pinned = process.platform === 'win32' ? getPinnedSize(win.id) : undefined
    if (pinned) {
      win.setBounds({ x: nextX, y: nextY, width: pinned.width, height: pinned.height }, false)
      return
    }
    win.setPosition(nextX, nextY, false)
  }

  private resolvePosition(): FloatingBallPosition {
    const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    return resolveFloatingBallPosition({
      savedPosition: this.settings.position,
      displays: this.getDisplayInfos(),
      size: this.settings.size,
      cursorDisplayId: cursorDisplay.id
    })
  }

  private getDisplayInfos(): FloatingBallDisplayInfo[] {
    return screen.getAllDisplays().map((display) => ({
      id: display.id,
      workArea: display.workArea
    }))
  }

  private buildRendererState(message?: string): FloatingBallRendererState {
    return {
      label: this.settings.label,
      size: this.settings.size,
      opacity: this.settings.opacity,
      shadowPadding: FLOATING_BALL_SHADOW_PADDING,
      status: this.status,
      theme: this.options.themeManager.getActualTheme(),
      iconDataUrl: getFloatingBallIconDataUrl(this.settings),
      message
    }
  }

  private pushState(message?: string): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send('floating-ball:state', this.buildRendererState(message))
  }

  private setStatus(status: FloatingBallRendererState['status'], message?: string): void {
    this.clearStatusTimer()
    this.status = status
    this.pushState(message)
    if (status === 'idle' || status === 'busy') return
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null
      this.status = 'idle'
      this.pushState()
    }, FLOATING_BALL_STATUS_RESET_MS)
  }

  private clearStatusTimer(): void {
    if (!this.statusTimer) return
    clearTimeout(this.statusTimer)
    this.statusTimer = null
  }

  private handleClick(): void {
    void this.executeFloatingBallAction('click')
  }

  private async handleDoubleClick(): Promise<void> {
    await this.executeFloatingBallAction('doubleClick')
  }

  private async executeFloatingBallAction(gesture: FloatingBallGesture): Promise<void> {
    const binding = this.settings.actions[gesture]
    if (binding.type === 'inheritClick') {
      if (gesture === 'click') {
        this.options.toggleMainWindow()
        return
      }
      await this.executeFloatingBallAction('click')
      return
    }

    if (binding.type === 'builtin') {
      if (binding.action === 'toggleMulby') {
        this.options.toggleMainWindow()
        return
      }
      if (binding.action === 'captureRegion') {
        await this.handleRegionCapture()
      }
      return
    }

    await this.executeCommandAction(binding.target)
  }

  private async executeCommandAction(target: FloatingBallCommandTarget): Promise<void> {
    this.setStatus('busy', target.commandLabel ? `正在打开 ${target.commandLabel}` : '正在打开指令')
    try {
      const result = target.cmdId && target.cmdSignature
        ? await this.options.pluginManager.runCommand({
          pluginId: target.pluginId,
          featureCode: target.featureCode,
          cmdId: target.cmdId,
          cmdSignature: target.cmdSignature,
          input: EMPTY_ACTION_PAYLOAD
        })
        : await this.options.pluginManager.run(target.pluginId, target.featureCode, EMPTY_ACTION_PAYLOAD)
      if (!result.success) {
        this.setStatus('error', result.error || '指令执行失败')
        notify(result.error || '指令执行失败')
        return
      }
      if (result.uiMode === 'attached') {
        this.options.showMainWindow({ skipAutoPaste: true })
      }
      this.setStatus('success', '已打开')
    } catch (error) {
      const message = error instanceof Error ? error.message : '指令执行失败'
      this.setStatus('error', message)
      notify(message)
    }
  }

  private handleDragStart(point: { screenX: number; screenY: number }): void {
    if (!this.window || this.window.isDestroyed()) return
    const [x, y] = this.window.getPosition()
    this.dragOffsetX = point.screenX - x
    this.dragOffsetY = point.screenY - y
  }

  private handleDragging(point: { screenX: number; screenY: number }): void {
    if (!this.window || this.window.isDestroyed()) return
    this.moveWindow(this.window, point.screenX - this.dragOffsetX, point.screenY - this.dragOffsetY)
  }

  private handleDragEnd(): void {
    if (!this.window || this.window.isDestroyed()) return
    const bounds = this.window.getBounds()
    const visualPosition = getFloatingBallVisualPosition({ x: bounds.x, y: bounds.y })
    const display = screen.getDisplayNearestPoint({
      x: visualPosition.x + this.settings.size / 2,
      y: visualPosition.y + this.settings.size / 2
    })
    const next = this.settings.snapToEdge
      ? snapFloatingBallPosition({
        position: visualPosition,
        display: { id: display.id, workArea: display.workArea },
        size: this.settings.size
      })
      : resolveFloatingBallPosition({
        savedPosition: { ...visualPosition, displayId: display.id },
        displays: [{ id: display.id, workArea: display.workArea }],
        size: this.settings.size
      })

    const windowPosition = getFloatingBallWindowPosition(next)
    this.moveWindow(this.window, windowPosition.x, windowPosition.y)
    this.persistSettings({ position: next })
  }

  private async handleFileDrop(input: FloatingBallFileDropItem[]): Promise<void> {
    const files = this.normalizeDroppedFiles(input)
    if (files.length === 0) {
      this.setStatus('error', '没有可投递的文件')
      return
    }

    if (isFloatingBallPluginPackageDrop(files)) {
      await this.installPluginPackage(files)
      return
    }

    const payload = buildFloatingBallFilePayload(files)
    this.deliverPayload(payload)
    this.setStatus('success', `已投递 ${files.length} 个文件`)
  }

  private normalizeDroppedFiles(input: FloatingBallFileDropItem[]): FloatingBallFileDropItem[] {
    const out: FloatingBallFileDropItem[] = []
    const seen = new Set<string>()
    for (const item of Array.isArray(input) ? input : []) {
      const filePath = String(item?.path || '').trim()
      if (!filePath || seen.has(filePath) || !existsSync(filePath)) continue
      seen.add(filePath)
      try {
        const stat = statSync(filePath)
        out.push({
          path: filePath,
          name: String(item.name || '').trim() || basename(filePath),
          size: stat.isDirectory() ? 0 : stat.size,
          type: item.type || inferMimeFromPath(filePath),
          isDirectory: stat.isDirectory()
        })
      } catch {
        // Skip unreadable dropped entries.
      }
    }
    return out
  }

  private async installPluginPackage(files: FileInfo[]): Promise<void> {
    const pluginFile = files.find((file) => String(file.path || '').toLowerCase().endsWith('.inplugin'))
    if (!pluginFile) return
    this.setStatus('busy', '正在安装插件')
    try {
      const result = await this.installer.install(pluginFile.path)
      if (result.success && result.action !== 'already-installed') {
        await this.options.pluginManager.init()
        if (result.pluginName) {
          await this.options.pluginManager.initializePlugin(result.pluginName)
        }
      }
      if (!result.success) {
        this.setStatus('error', result.error || '插件安装失败')
        notify(result.error || '插件安装失败')
        return
      }
      const actionText = result.action === 'already-installed'
        ? '已是当前版本'
        : result.action === 'updated'
          ? '更新成功'
          : '安装成功'
      this.setStatus('success', actionText)
      notify(`插件 ${result.pluginName || pluginFile.name} ${actionText}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '插件安装失败'
      this.setStatus('error', message)
      notify(message)
    }
  }

  private async handleRegionCapture(): Promise<void> {
    this.setStatus('busy', '选择截图区域')
    this.suspendWindowForRegionCapture()
    try {
      const dataUrl = await startRegionCapture()
      await this.restoreWindowAfterRegionCapture()
      if (!dataUrl) {
        this.setStatus('idle')
        return
      }
      const image = dataUrlToPngBuffer(dataUrl)
      if (!image) {
        this.setStatus('error', '截图数据无效')
        return
      }
      this.deliverPayload({ format: 'image', image })
      this.setStatus('success', '截图已投递')
    } catch (error) {
      await this.restoreWindowAfterRegionCapture()
      const message = error instanceof Error ? error.message : '截图失败'
      this.setStatus('error', message)
      notify(message)
    }
  }

  private suspendWindowForRegionCapture(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    if (process.platform === 'win32') {
      this.destroyWindow()
      return
    }
    win.hide()
  }

  private async restoreWindowAfterRegionCapture(): Promise<void> {
    if (!this.settings.enabled) return
    try {
      if (process.platform === 'win32') {
        await this.ensureWindow()
        this.pushState()
        return
      }
      const win = this.window
      if (win && !win.isDestroyed()) {
        win.showInactive()
        this.pushState()
        return
      }
      await this.ensureWindow()
      this.pushState()
    } catch (error) {
      log.warn('[FloatingBall] Failed to restore floating ball after region capture:', error)
    }
  }

  private handleClipboardDelivery(): void {
    const payload = captureAutoPasteClipboardPayload()
    const hasContent = (payload.format === 'text' && Boolean(payload.text?.trim()))
      || (payload.format === 'image' && Boolean(payload.image))
      || (payload.format === 'files' && Boolean(payload.files?.length))
    if (!hasContent) {
      this.setStatus('error', '剪贴板为空')
      return
    }
    this.deliverPayload(payload)
    this.setStatus('success', '剪贴板已投递')
  }

  private deliverPayload(payload: AutoPasteClipboardPayload): void {
    this.options.showMainWindow({ skipAutoPaste: true })
    setTimeout(() => {
      const mainWindow = this.options.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send('clipboard:autoPaste', payload)
    }, FLOATING_BALL_PAYLOAD_DELAY_MS)
  }

  private showContextMenu(): void {
    if (!this.window || this.window.isDestroyed()) return
    const mainWindow = this.options.getMainWindow()
    const mainVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
    let pendingMenuAction: (() => void) | null = null
    const runAfterMenuClosed = (action: () => void) => {
      pendingMenuAction = action
    }
    const menu = Menu.buildFromTemplate([
      {
        label: mainVisible ? '隐藏 Mulby' : '显示 Mulby',
        click: () => runAfterMenuClosed(() => this.handleClick())
      },
      {
        label: '投递剪贴板',
        click: () => runAfterMenuClosed(() => this.handleClipboardDelivery())
      },
      {
        label: '区域截图投递',
        click: () => runAfterMenuClosed(() => void this.handleRegionCapture())
      },
      { type: 'separator' },
      {
        label: '悬浮球设置',
        click: () => runAfterMenuClosed(() => this.options.openFloatingBallSettings())
      },
      {
        label: '隐藏悬浮球',
        click: () => runAfterMenuClosed(() => this.persistSettings({ enabled: false }))
      },
      { type: 'separator' },
      {
        label: '退出 Mulby',
        click: () => runAfterMenuClosed(() => this.options.quitApp())
      }
    ])
    this.popupNativeContextMenu(menu, () => {
      const action = pendingMenuAction
      pendingMenuAction = null
      return action
    })
  }

  private popupNativeContextMenu(menu: Menu, consumePendingMenuAction?: () => (() => void) | null): void {
    const win = this.window
    if (!win || win.isDestroyed()) return

    let restored = false
    const keepFloatingBallOutOfTaskbar = () => {
      if (win.isDestroyed()) return
      try {
        win.setSkipTaskbar(true)
      } catch (error) {
        log.warn('[FloatingBall] Failed to keep floating ball out of taskbar:', error)
      }
    }
    const restoreMenuWindowChrome = () => {
      if (restored) return
      restored = true
      if (win.isDestroyed()) return
      try {
        keepFloatingBallOutOfTaskbar()
        win.setFocusable(false)
        if (win.isVisible()) win.showInactive()
        keepFloatingBallOutOfTaskbar()
      } catch (error) {
        log.warn('[FloatingBall] Failed to restore floating ball menu window chrome:', error)
      }
    }
    const completeMenu = () => {
      const action = consumePendingMenuAction?.() ?? null
      restoreMenuWindowChrome()
      if (action) {
        setTimeout(action, 0)
      }
      // Windows：菜单期间的 setFocusable/focus/showInactive 切换会破坏透明
      // 无框窗口的 Chromium 输入状态，导致左键单击/拖动失效（右键菜单仍可用）。
      // 与区域截图路径一致，菜单关闭后销毁重建窗口以刷新输入状态。
      if (process.platform === 'win32') {
        setTimeout(() => {
          void this.recreateWindowForFreshInputState()
        }, 0)
      }
    }

    keepFloatingBallOutOfTaskbar()
    if (process.platform !== 'win32') {
      menu.popup({ window: win, callback: completeMenu })
      return
    }

    try {
      win.setFocusable(true)
      keepFloatingBallOutOfTaskbar()
      if (!win.isVisible()) win.show()
      win.focus()
      keepFloatingBallOutOfTaskbar()
      menu.popup({
        window: win,
        callback: completeMenu
      })
    } catch (error) {
      restoreMenuWindowChrome()
      log.warn('[FloatingBall] Failed to show context menu:', error)
    }
  }

  /**
   * 销毁并重建悬浮球窗口，确保 Chromium 输入状态是新鲜的。
   *
   * Windows 上透明无框窗口经历 focus/show 切换后，左键 pointer 事件流
   * 可能不再派发到渲染进程（contextmenu 仍正常），唯一可靠的恢复方式是重建窗口。
   * 若窗口已被菜单动作销毁（如区域截图、隐藏悬浮球、退出应用），则跳过。
   */
  private async recreateWindowForFreshInputState(): Promise<void> {
    if (!this.settings.enabled) return
    if (!this.window || this.window.isDestroyed()) return
    try {
      this.destroyWindow()
      await this.ensureWindow()
      this.pushState()
    } catch (error) {
      log.warn('[FloatingBall] Failed to recreate floating ball window for fresh input state:', error)
    }
  }

  private persistSettings(patch: Partial<FloatingBallSettings>): void {
    const current = this.options.settingsManager.getSettings()
    this.options.settingsManager.updateSettings({
      floatingBall: {
        ...current.floatingBall,
        ...patch
      }
    })
    this.applySettings()
  }

  private destroyWindow(): void {
    const win = this.window
    this.window = null
    if (!win || win.isDestroyed()) return
    unpinWindowSize(win.id)
    try {
      win.removeAllListeners()
      win.destroy()
    } catch (error) {
      log.warn('[FloatingBall] Failed to destroy window:', error)
    }
  }
}
