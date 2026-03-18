import { app, BrowserWindow, globalShortcut, screen, crashReporter, type Rectangle } from 'electron'
import http from 'http'
import https from 'https'
import { join } from 'path'
import { registerAllHandlers } from './ipc'
import { setAiCapabilityPolicyResolver, setAiToolExecutor, setAiPluginToolResolver } from './ai'
import { aiMcpService, isMcpToolName } from './ai/mcp'
import {
  AI_RUN_COMMAND_TOOL_NAME,
  normalizeFailedRunCommandResult,
  parseAiRunCommandArgs
} from './ai/tools/run-command-tool'
import { createAiInternalToolRuntime } from './ai/tools/internal-tool-runtime'
import { resolveAiCapabilityPolicy } from './ai/tools/capability-policy'
import { isAiInternalToolName } from './ai/tools/internal-tools'
import { PluginManager } from './plugin'
import { PluginToolRegistry, isPluginToolName, parsePluginToolId } from './plugin/plugin-tools'
import { pluginDesktop } from './plugin/desktop'
import { setHotKeySettingRedirectHandler } from './plugin/dynamic-features'
import { PluginWindowManager } from './plugin/window'
import { ThemeManager } from './services/theme'
import { setUiDialogThemeResolver } from './services/ui-dialog-service'
import { isIgnoringBlur, startIgnoringBlur, stopIgnoringBlur, setWindowsProvider } from './services/blur-manager'
import { appSettingsManager } from './services/app-settings'
import { AppShortcutManager } from './services/app-shortcuts'
import { AppTrayManager } from './services/app-tray'
import { TrayMenuWindowManager } from './services/tray-menu-window'
import { ClipboardWatcher } from './services/clipboard-watcher-v2'
import { ClipboardHistoryManager } from './services/clipboard-history'
import { commandRunnerService } from './services/command-runner'
import { setLoggerMinLevel } from './services/logger'
import { attachShortcutRecordingGuard } from './services/shortcut-recording-guard'
import { SystemPluginWindowManager } from './services/system-plugin-window-manager'
import {
  SystemPageWindowManager,
  type OpenSystemPagePayload as OpenSystemPageWindowPayload,
  type SettingsCenterSection
} from './services/system-page-window-manager'
import {
  getMainWindowVisibleBounds,
  getMainWindowWindowBounds,
  getMainWindowWindowSize
} from './main-window-frame'
import { patchConsoleWithTimestamp } from '../shared/utils/console'

patchConsoleWithTimestamp()

const APP_DISPLAY_NAME = 'Mulby'
const WINDOWS_APP_USER_MODEL_ID = 'com.mulby.app'
const MAIN_WINDOW_SHADOW_MARGIN = 12
const MAIN_WINDOW_TOGGLE_DEBOUNCE_MS = 180
const WINDOWS_SHOW_BLUR_GUARD_MS = 260
const MAIN_WINDOW_STATE_SAVE_DEBOUNCE_MS = 500
const MAIN_WINDOW_SHADOW_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      pointer-events: none;
    }
    .shadow {
      position: absolute;
      inset: ${MAIN_WINDOW_SHADOW_MARGIN}px;
      border-radius: 12px;
      box-shadow:
        0 2px 10px rgba(15, 23, 42, 0.12),
        0 1px 2px rgba(15, 23, 42, 0.08);
    }
  </style>
</head>
<body>
  <div class="shadow"></div>
</body>
</html>`
const MAIN_WINDOW_SHADOW_URL = `data:text/html;charset=UTF-8,${encodeURIComponent(MAIN_WINDOW_SHADOW_HTML)}`

app.setName(APP_DISPLAY_NAME)
if (process.platform === 'win32') {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
}

// 开发模式下禁用安全警告（Vite HMR 需要 unsafe-eval）
const isDev = !app.isPackaged
if (isDev) {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'
}

// 强制启用硬件加速（提升性能）
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('disable-software-rasterizer')

// 启动崩溃报告器（生成本地 crash dump，用于分析 Native 层崩溃）
// 必须在 app 模块加载后尽早调用
crashReporter.start({
  productName: APP_DISPLAY_NAME,
  companyName: APP_DISPLAY_NAME,
  submitURL: '', // 不上传，只保存本地
  uploadToServer: false,
  ignoreSystemCrashHandler: false
})
console.log('[CrashReporter] 崩溃报告器已启动，dump 目录:', app.getPath('crashDumps'))

let mainWindow: BrowserWindow | null = null
let mainShadowWindow: BrowserWindow | null = null
let appTrayManager: AppTrayManager | null = null
let trayMenuWindowManager: TrayMenuWindowManager | null = null
let isQuitting = false
let shouldRestartAfterQuit = false
let shutdownFinalizeScheduled = false
let hasShutdownCompleted = false
let shutdownPromise: Promise<void> | null = null
let mainWindowBlurHideTimer: NodeJS.Timeout | null = null
let mainWindowStateSaveTimer: NodeJS.Timeout | null = null
let suppressMainBlurHideUntil = 0
let lastMainWindowToggleAt = 0
let mainWindowHasBeenShown = false
let deferMainShadowShow = false
const pluginManager = new PluginManager()
const pluginWindowManager = new PluginWindowManager()
const themeManager = new ThemeManager()
setUiDialogThemeResolver(() => themeManager.getActualTheme())
setLoggerMinLevel(appSettingsManager.getSettings().developer.logLevel)
const clipboardWatcher = new ClipboardWatcher()
const clipboardHistoryManager = new ClipboardHistoryManager()
const systemPluginWindowManager = new SystemPluginWindowManager()
const systemPageWindowManager = new SystemPageWindowManager()
const aiInternalToolRuntime = createAiInternalToolRuntime({
  getToolingSettings: () => appSettingsManager.getSettings().aiTooling,
  runCommand: (input, context) => commandRunnerService.runCommand(input, context),
  resolveRunCommandContext: (toolContext) => {
    const pluginName = toolContext?.pluginName
    const plugin = pluginName ? pluginManager.get(pluginName) : undefined
    const source = pluginName ? 'plugin' : 'app'
    return {
      source,
      pluginId: pluginName || undefined,
      runCommandAllowed: plugin ? plugin.manifest.permissions?.runCommand === true : undefined,
      allowShellOverride: source === 'app'
    }
  }
})

// 创建 Plugin Tools 注册中心并注入到 AI 管道
const pluginToolRegistry = new PluginToolRegistry()
setAiPluginToolResolver(() => pluginToolRegistry.resolveToolsForAi())

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
    const message = String(error.message || '').toLowerCase()
    return message.includes('abort') || message.includes('cancelled') || message.includes('canceled')
  }
  const message = String(error || '').toLowerCase()
  return message.includes('abort') || message.includes('cancelled') || message.includes('canceled')
}

function isWindowAvailable(win: BrowserWindow | null): win is BrowserWindow {
  if (!win) return false
  try {
    return !win.isDestroyed()
  } catch {
    return false
  }
}

const handleSecondInstance = () => {
  if (isQuitting) {
    return
  }

  if (!isWindowAvailable(mainWindow)) {
    mainWindow = null
    if (app.isReady()) {
      showMainWindow()
    } else {
      void app.whenReady().then(() => {
        if (!isQuitting) {
          showMainWindow()
        }
      })
    }
    return
  }
  try {
    if (!mainWindow.isVisible()) {
      toggleWindow()
    } else {
      mainWindow.focus()
    }
  } catch (error) {
    console.warn('[Main] Failed to focus existing window on second-instance:', error)
    mainWindow = null
  }
}

const handleAppActivate = () => {
  if (isQuitting) return

  try {
    app.show()
  } catch (error) {
    console.warn('[Main] Failed to restore app state on activate:', error)
  }

  const detachedWindows = pluginWindowManager.getAllDetachedWindows()
  if (detachedWindows.length > 0) {
    detachedWindows.forEach(win => {
      if (!isWindowAvailable(win)) return
      try {
        if (!win.isVisible()) {
          win.show()
        }
        if (win.isMinimized()) {
          win.restore()
        }
        win.focus()
      } catch (error) {
        console.warn('[Main] Failed to restore detached window on activate:', error)
      }
    })
    return
  }

  const systemDetached = systemPageWindowManager.getDetachedWindow()
  if (systemDetached && isWindowAvailable(systemDetached)) {
    try {
      if (!systemDetached.isVisible()) {
        systemDetached.show()
      }
      if (systemDetached.isMinimized()) {
        systemDetached.restore()
      }
      systemDetached.focus()
      return
    } catch (error) {
      console.warn('[Main] Failed to restore detached system page window on activate:', error)
    }
  }

  showMainWindow()
}

setAiToolExecutor(async ({ name, args, context, callId, abortSignal }) => {
  if (name === AI_RUN_COMMAND_TOOL_NAME) {
    const input = parseAiRunCommandArgs(args)
    const pluginName = context?.pluginName
    const plugin = pluginName ? pluginManager.get(pluginName) : undefined
    try {
      const source = pluginName ? 'plugin' : 'app'
      return await commandRunnerService.runCommand(input, {
        source,
        pluginId: pluginName || undefined,
        runCommandAllowed: plugin ? plugin.manifest.permissions?.runCommand === true : undefined,
        allowShellOverride: source === 'app',
        abortSignal
      })
    } catch (error) {
      if (abortSignal?.aborted || isAbortLikeError(error)) {
        throw error instanceof Error ? error : new Error(String(error))
      }
      return normalizeFailedRunCommandResult({
        error,
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        shell: input.shell
      })
    }
  }

  if (isAiInternalToolName(name)) {
    return await aiInternalToolRuntime.execute({
      name,
      args,
      context
    })
  }

  if (isMcpToolName(name)) {
    return await aiMcpService.callToolById({
      toolId: name,
      args,
      context,
      callId
    })
  }

  // Plugin Tool 分派：通过 plugin_tool__{sanitizedPluginId}__{toolName} 格式识别
  if (isPluginToolName(name)) {
    const { pluginId: sanitizedId, toolName } = parsePluginToolId(name)

    // 通过注册中心还原原始 pluginId（sanitizedId → originalPluginId）
    const pluginId = pluginToolRegistry.resolveOriginalPluginId(sanitizedId) || sanitizedId

    // 确保插件 host 已初始化（懒加载：首次调用时自动启动 host 进程）
    const plugin = pluginManager.get(pluginId)
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId} (sanitized: ${sanitizedId})`)
    }
    if (!plugin.enabled) {
      throw new Error(`Plugin is disabled: ${pluginId}`)
    }
    await pluginManager.initializePlugin(pluginId)

    const hostManager = pluginManager.getHostManager()
    // initPlugin 会确保 host 进程创建并就绪
    const inited = await hostManager.initPlugin(plugin)
    if (!inited) {
      throw new Error(`Failed to initialize host for plugin: ${pluginId}`)
    }

    const result = await hostManager.callHostMethod(pluginId, `__plugin_tool__${toolName}`, [args])
    // 解包 host 返回的结果
    if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
      return (result as { data: unknown }).data
    }
    return result
  }

  const pluginName = context?.pluginName
  if (!pluginName) {
    throw new Error('AI tool execution requires plugin context')
  }
  const hostManager = pluginManager.getHostManager()
  const result = await hostManager.callHostMethod(pluginName, name, [args])

  // 解包 host 返回的结果：{ success: true, data: {...} } -> {...}
  if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
    return (result as { data: unknown }).data
  }

  return result
})

setAiCapabilityPolicyResolver(({ option, requestedCapabilities, selectedSkills }) => {
  const settings = appSettingsManager.getSettings().aiTooling
  if (!settings.enabled) {
    return {
      allowedCapabilities: [],
      deniedCapabilities: requestedCapabilities,
      reasons: ['aiTooling disabled']
    }
  }
  return resolveAiCapabilityPolicy({
    option,
    requestedCapabilities,
    selectedSkills,
    policy: settings.capabilityPolicy
  })
})

async function shutdownMainProcessResources(): Promise<void> {
  if (hasShutdownCompleted) {
    return
  }
  if (shutdownPromise) {
    return shutdownPromise
  }

  shutdownPromise = (async () => {
    try {
      clipboardHistoryManager.stop()
    } catch (error) {
      console.error('[Main] Failed to stop clipboard history manager:', error)
    }

    try {
      clipboardWatcher.stop()
    } catch (error) {
      console.error('[Main] Failed to stop clipboard watcher:', error)
    }

    try {
      await pluginManager.destroy()
    } catch (error) {
      console.error('[Main] Failed to destroy plugin manager:', error)
    }

    try {
      systemPageWindowManager.closeAll()
    } catch (error) {
      console.error('[Main] Failed to close system page windows:', error)
    }

    try {
      appTrayManager?.destroy()
      appTrayManager = null
    } catch (error) {
      console.error('[Main] Failed to destroy app tray manager:', error)
    }

    try {
      trayMenuWindowManager?.destroy()
      trayMenuWindowManager = null
    } catch (error) {
      console.error('[Main] Failed to destroy tray menu window manager:', error)
    }

    try {
      globalShortcut.unregisterAll()
    } catch (error) {
      console.error('[Main] Failed to unregister global shortcuts:', error)
    }
  })().finally(() => {
    hasShutdownCompleted = true
  })

  return shutdownPromise
}

// 单实例锁：确保只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  isQuitting = true
  app.quit()
} else {
  // 当第二个实例启动时，聚焦到已有窗口
  app.on('second-instance', handleSecondInstance)
}

function getMainWindow() {
  return mainWindow
}

const WINDOWS_WM_INITMENU = 0x0116

function suppressSystemContextMenu(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  win.on('system-context-menu', (event) => {
    event.preventDefault()
  })
  try {
    if (!win.isWindowMessageHooked(WINDOWS_WM_INITMENU)) {
      win.hookWindowMessage(WINDOWS_WM_INITMENU, () => {
        if (!win.isDestroyed()) {
          win.setEnabled(false)
          win.setEnabled(true)
        }
      })
    }
  } catch (error) {
    console.warn('[Main] Failed to hook WM_INITMENU on main window:', error)
  }
  win.once('closed', () => {
    try {
      if (!win.isDestroyed() && win.isWindowMessageHooked(WINDOWS_WM_INITMENU)) {
        win.unhookWindowMessage(WINDOWS_WM_INITMENU)
      }
    } catch {
      // ignore
    }
  })
}

function clearMainWindowBlurHideTimer(): void {
  if (!mainWindowBlurHideTimer) return
  clearTimeout(mainWindowBlurHideTimer)
  mainWindowBlurHideTimer = null
}

function clearMainWindowStateSaveTimer(): void {
  if (!mainWindowStateSaveTimer) return
  clearTimeout(mainWindowStateSaveTimer)
  mainWindowStateSaveTimer = null
}

function persistMainWindowState(): void {
  if (!isWindowAvailable(mainWindow)) {
    return
  }

  const bounds = getMainWindowVisibleBounds(mainWindow.getBounds())
  if (bounds.height > 100) {
    appSettingsManager.updateSettings({
      window: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y
      }
    })
    return
  }

  appSettingsManager.updateSettings({
    window: {
      width: bounds.width,
      x: bounds.x,
      y: bounds.y
    }
  })
}

function scheduleMainWindowStateSave(): void {
  clearMainWindowStateSaveTimer()
  mainWindowStateSaveTimer = setTimeout(() => {
    mainWindowStateSaveTimer = null
    persistMainWindowState()
  }, MAIN_WINDOW_STATE_SAVE_DEBOUNCE_MS)
}

function flushMainWindowStateSave(): void {
  clearMainWindowStateSaveTimer()
  persistMainWindowState()
}

function getDefaultMainWindowVisiblePosition(visibleBounds: Rectangle): { x: number; y: number } {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { width: screenWidth, height: screenHeight } = display.workAreaSize
  const { x: screenX, y: screenY } = display.workArea

  return {
    x: screenX + Math.round((screenWidth - visibleBounds.width) / 2),
    y: screenY + Math.round(screenHeight / 5)
  }
}

function resolveMainWindowVisibleBounds(currentVisibleBounds: Rectangle): Rectangle {
  const settings = appSettingsManager.getSettings()
  if (settings.window?.x !== undefined && settings.window?.y !== undefined) {
    return {
      ...currentVisibleBounds,
      x: settings.window.x,
      y: settings.window.y
    }
  }

  return {
    ...currentVisibleBounds,
    ...getDefaultMainWindowVisiblePosition(currentVisibleBounds)
  }
}

function shouldSuppressMainBlurHide(): boolean {
  return process.platform === 'win32' && Date.now() < suppressMainBlurHideUntil
}

function extendMainBlurHideSuppression(durationMs: number): void {
  if (process.platform !== 'win32') return
  suppressMainBlurHideUntil = Math.max(suppressMainBlurHideUntil, Date.now() + durationMs)
}

function shouldUseMainShadowWindow(): boolean {
  // Windows already renders the search surface shadow in the renderer.
  // A second transparent owner window causes severe DWM flicker while dragging.
  return process.platform !== 'win32'
}

function hideMainWindow() {
  if (!isWindowAvailable(mainWindow)) {
    clearMainWindowBlurHideTimer()
    closeMainShadowWindow()
    mainWindow = null
    return
  }

  clearMainWindowBlurHideTimer()
  trayMenuWindowManager?.hide()
  pluginWindowManager.hidePanelWindow()
  systemPageWindowManager.hideAttached()
  mainWindow.hide()
  mainShadowWindow?.hide()

  // macOS: 如果有独立窗口，确保 dock 图标保持显示
  if (process.platform === 'darwin' && app.dock) {
    const hasDetachedWindows = pluginWindowManager.getAllDetachedWindows().length > 0
      || Boolean(systemPageWindowManager.getDetachedWindow())
    if (hasDetachedWindows) {
      void app.dock.show()
    }
  }
}

function createMainShadowWindow() {
  if (!shouldUseMainShadowWindow()) return
  if (!isWindowAvailable(mainWindow)) return
  if (isWindowAvailable(mainShadowWindow)) return

  const shadow = new BrowserWindow({
    width: 1,
    height: 1,
    x: 0,
    y: 0,
    frame: false,
    show: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    parent: mainWindow,
    modal: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  shadow.setIgnoreMouseEvents(true, { forward: true })
  void shadow.loadURL(MAIN_WINDOW_SHADOW_URL)
  shadow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  shadow.on('closed', () => {
    if (mainShadowWindow && mainShadowWindow.id === shadow.id) {
      mainShadowWindow = null
    }
  })

  mainShadowWindow = shadow
}

function syncMainShadowBounds() {
  if (!shouldUseMainShadowWindow()) return
  if (!isWindowAvailable(mainWindow) || !isWindowAvailable(mainShadowWindow)) return
  const bounds = mainWindow.getBounds()
  const margin = MAIN_WINDOW_SHADOW_MARGIN
  mainShadowWindow.setBounds({
    x: bounds.x - margin,
    y: bounds.y - margin,
    width: Math.max(1, bounds.width + margin * 2),
    height: Math.max(1, bounds.height + margin * 2)
  })
}

function showMainShadowWindow() {
  if (!shouldUseMainShadowWindow()) return
  if (deferMainShadowShow) return
  if (!isWindowAvailable(mainWindow)) return
  if (!isWindowAvailable(mainShadowWindow)) {
    createMainShadowWindow()
  }
  if (!isWindowAvailable(mainShadowWindow)) return
  syncMainShadowBounds()
  mainShadowWindow.showInactive()
}

function closeMainShadowWindow() {
  if (isWindowAvailable(mainShadowWindow)) {
    mainShadowWindow.close()
  }
  mainShadowWindow = null
}

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

function createWindow() {
  const settings = appSettingsManager.getSettings()
  const visibleWidth = settings.window?.width || 800
  const initialVisibleBounds = resolveMainWindowVisibleBounds({
    x: 0,
    y: 0,
    width: visibleWidth,
    height: 62
  })
  const initialWindowBounds = getMainWindowWindowBounds(initialVisibleBounds)
  const minCollapsedSize = getMainWindowWindowSize(400, 62)

  mainWindow = new BrowserWindow({
    width: initialWindowBounds.width,
    height: initialWindowBounds.height,
    x: initialWindowBounds.x,
    y: initialWindowBounds.y,
    show: false,
    frame: false,
    resizable: true, // 允许用户调整大小
    minHeight: minCollapsedSize.height,   // 锁定初始高度
    maxHeight: minCollapsedSize.height,
    minWidth: minCollapsedSize.width,   // 设置最小宽度
    skipTaskbar: true,
    transparent: true,
    hasShadow: false, // 透明无边框窗口使用自定义阴影，避免原生阴影黑边
    type: 'panel', // macOS 上 panel 类型有助于浮动在全屏应用之上
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  // macOS: 设置窗口在所有工作区可见，并使用 floating 级别置顶
  if (process.platform === 'darwin') {
    // 禁止全屏，防止与 Spaces 行为冲突
    mainWindow.setFullScreenable(false)
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    mainWindow.setAlwaysOnTop(true, 'floating')
  } else {
    mainWindow.setAlwaysOnTop(true)
  }
  if (shouldUseMainShadowWindow()) {
    createMainShadowWindow()
  }

  mainWindow.once('ready-to-show', () => {
    // console.log('[Main] Window ready-to-show event fired')
  })

  suppressSystemContextMenu(mainWindow)
  attachShortcutRecordingGuard(mainWindow)

  mainWindow.on('closed', () => {
    clearMainWindowBlurHideTimer()
    clearMainWindowStateSaveTimer()
    closeMainShadowWindow()
    systemPluginWindowManager.setMainWindow(null)
    systemPageWindowManager.setMainWindow(null)
    mainWindow = null
  })

  // 默认关闭行为：隐藏到托盘（显式退出时除外）
  mainWindow.on('close', (event) => {
    flushMainWindowStateSave()
    const closeToTray = appSettingsManager.getSettings().tray.closeToTray
    if (isQuitting || !closeToTray) {
      return
    }
    event.preventDefault()
    hideMainWindow()
  })

  // 失焦隐藏（类似 uTools 的交互）
  mainWindow.on('blur', () => {
    if (isIgnoringBlur() || shouldSuppressMainBlurHide()) return

    clearMainWindowBlurHideTimer()

    // 延迟检查，让焦点转移完成
    mainWindowBlurHideTimer = setTimeout(() => {
      mainWindowBlurHideTimer = null
      if (isIgnoringBlur() || shouldSuppressMainBlurHide()) return
      // 如果焦点转移到了面板窗口，不隐藏
      const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
      if (panelWin && panelWin.isFocused()) {
        return
      }
      // 如果焦点转移到了系统页面附着窗口，不隐藏
      const systemPageAttached = systemPageWindowManager.getAttachedWindow()
      if (systemPageAttached && systemPageAttached.isFocused()) {
        return
      }
      // 焦点转移到其他地方，隐藏主窗口和面板
      hideMainWindow()
    }, 50)
  })

  // 状态保存防抖
  let saveTimer: NodeJS.Timeout | null = null
  const saveState = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const bounds = getMainWindowVisibleBounds(mainWindow.getBounds())
      // 只保存系统页面模式的高度（高度 > 100 说明是展开状态）
      // 搜索框模式只保存宽度和位置
      if (bounds.height > 100) {
        appSettingsManager.updateSettings({
          window: {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y
          }
        })
      } else {
        appSettingsManager.updateSettings({
          window: {
            width: bounds.width,
            x: bounds.x,
            y: bounds.y
          }
        })
      }
    }, MAIN_WINDOW_STATE_SAVE_DEBOUNCE_MS)
  }

  // 监听窗口调整和移动
  mainWindow.on('resize', saveState)
  mainWindow.on('move', scheduleMainWindowStateSave)
  mainWindow.on('resize', syncMainShadowBounds)
  mainWindow.on('show', showMainShadowWindow)
  mainWindow.on('hide', () => {
    flushMainWindowStateSave()
    if (isWindowAvailable(mainShadowWindow)) {
      mainShadowWindow.hide()
    }
  })

  const loadApp = async () => {
    if (process.env.VITE_DEV_SERVER_URL) {
      const devUrl = process.env.VITE_DEV_SERVER_URL
      const reachable = await canReachUrl(devUrl)
      if (reachable) {
        await mainWindow?.loadURL(devUrl)
        return
      }
      console.warn(`[Main] Dev server not reachable at ${devUrl}, falling back to local file.`)
    }

    const isDevEnv = !app.isPackaged || process.env.NODE_ENV === 'development' || !process.env.NODE_ENV
    if (isDevEnv) {
      const devUrl = 'http://localhost:5173'
      const reachable = await canReachUrl(devUrl)
      if (reachable) {
        await mainWindow?.loadURL(devUrl)
        return
      }
    }

    await mainWindow?.loadFile(join(__dirname, '../renderer/index.html'))
  }

  void loadApp().catch((e) => {
    console.error('[Main] Failed to load app:', e)
  })
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  clearMainWindowBlurHideTimer()
  trayMenuWindowManager?.hide()

  // 每次显示前都强制重置关键属性，确保窗口行为正确
  if (process.platform === 'darwin') {
    try {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      mainWindow.setAlwaysOnTop(true, 'floating')

      // 如果有独立窗口，在显示主窗口之前先确保 dock 图标显示
      // 并且设置一个短暂的延迟，确保 dock 状态稳定
      const hasDetachedWindows = pluginWindowManager.getAllDetachedWindows().length > 0
        || Boolean(systemPageWindowManager.getDetachedWindow())
      if (hasDetachedWindows && app.dock) {
        void app.dock.show()
      }
    } catch (e) {
      console.error('Error setting window properties:', e)
    }
  } else {
    mainWindow.setAlwaysOnTop(true)
  }

  try {
    const visibleBounds = getMainWindowVisibleBounds(mainWindow.getBounds())
    const targetVisibleBounds = resolveMainWindowVisibleBounds(visibleBounds)
    const windowBounds = getMainWindowWindowBounds(targetVisibleBounds)
    mainWindow.setPosition(windowBounds.x, windowBounds.y)

    // 临时忽略 blur 事件，防止 show/focus 过程中误触发
    startIgnoringBlur()
    extendMainBlurHideSuppression(WINDOWS_SHOW_BLUR_GUARD_MS)

    // Windows transparent window anti-flicker:
    // When a transparent window is re-shown after hide(), DWM briefly composites
    // a stale cached frame before the Chromium renderer produces a fresh one,
    // causing a visible show→blank→show flicker. Setting opacity to 0 before
    // show() makes the stale frame invisible; we restore opacity once the
    // compositor has had time to produce a fresh frame.
    const needsOpacityGuard = process.platform === 'win32' && mainWindowHasBeenShown
    if (needsOpacityGuard) {
      deferMainShadowShow = true
      mainWindow.setOpacity(0)
    }

    mainWindow.show()
    mainWindow.focus()
    mainWindowHasBeenShown = true

    if (needsOpacityGuard) {
      mainWindow.webContents.invalidate()
      setTimeout(() => {
        deferMainShadowShow = false
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
          mainWindow.setOpacity(1)
          showMainShadowWindow()
        }
      }, 50)
    }

    // 恢复之前隐藏的面板
    pluginWindowManager.showPanelWindow()
    systemPageWindowManager.showAttached()

    // 智能剪贴板自动粘贴
    const appSettings = appSettingsManager.getSettings()
    if (appSettings.input.autoPasteOnShow && clipboardWatcher.isRecentlyChanged(appSettings.input.autoPasteMaxAge)) {
      // 通知渲染进程尝试自动粘贴
      mainWindow.webContents.send('clipboard:autoPaste')
    }

    // 延迟恢复 blur 监听（确保窗口完全获得焦点）
    stopIgnoringBlur()

    // macOS: 再次确保 dock 图标状态正确（在 show 之后）
    if (process.platform === 'darwin' && app.dock) {
      const hasDetachedWindows = pluginWindowManager.getAllDetachedWindows().length > 0
        || Boolean(systemPageWindowManager.getDetachedWindow())
      if (hasDetachedWindows) {
        // 使用 setImmediate 确保在下一个事件循环中执行
        setImmediate(() => {
          if (app.dock) {
            void app.dock.show()
          }
        })
      }
    }
  } catch (e) {
    stopIgnoringBlur()
    console.error('Error in show sequence:', e)
  }
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  const now = Date.now()
  if (now - lastMainWindowToggleAt < MAIN_WINDOW_TOGGLE_DEBOUNCE_MS) {
    return
  }
  lastMainWindowToggleAt = now
  if (mainWindow.isVisible()) {
    hideMainWindow()
  } else {
    showMainWindow()
  }
}

function openSystemPageView(payload: OpenSystemPageWindowPayload) {
  const detached = systemPageWindowManager.getDetachedWindow()
  if (!detached) {
    showMainWindow()
  }
  void systemPageWindowManager.openAttached(payload)
}

function openSettingsView(section: SettingsCenterSection = 'general') {
  openSystemPageView({
    page: 'settings',
    settingsSection: section
  })
}

function openCommandShortcutSettingsView(cmdLabel?: string) {
  openSystemPageView({
    page: 'settings',
    settingsSection: 'commandQuickLaunch',
    shortcutCommandHint: cmdLabel?.trim() || ''
  })
}

function openPluginStoreView() {
  openSystemPageView({ page: 'plugin-store' })
}

function openPluginManagerView() {
  openSystemPageView({ page: 'plugin-manager' })
}

function openAiSettingsView() {
  openSystemPageView({ page: 'ai-settings' })
}

function openBackgroundPluginsView() {
  openSystemPageView({ page: 'background-plugins' })
}

function openTaskSchedulerView() {
  openSystemPageView({ page: 'task-scheduler' })
}

function openLogViewerView() {
  openSystemPageView({ page: 'log-viewer' })
}

function resetMainWindowPosition() {
  const settings = appSettingsManager.getSettings()
  appSettingsManager.updateSettings({
    window: {
      ...(settings.window || { width: 800 }),
      x: undefined,
      y: undefined
    }
  })
}

function restartMainProcess() {
  if (isQuitting) return
  shouldRestartAfterQuit = true
  quitMainProcess()
}

function quitMainProcess() {
  if (isQuitting) return
  isQuitting = true
  app.quit()
}

app.whenReady().then(async () => {
  // macOS: 默认隐藏 Dock 图标，只有独立窗口时才显示
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  // 启动剪贴板监听器
  clipboardWatcher.start()
  console.log(`[ClipboardWatcher] Started - Mode: ${clipboardWatcher.isNativeMode() ? 'Native (zero overhead)' : 'Polling (fallback)'}`)

  // 启动剪贴板历史记录管理器
  clipboardHistoryManager.start()
  console.log('[ClipboardHistory] Started')

  // 设置剪贴板历史管理器到插件管理器
  pluginManager.setClipboardHistoryManager(clipboardHistoryManager)

  const appShortcutManager = new AppShortcutManager({
    toggleWindow: () => toggleWindow(),
    openSettings: () => openSettingsView(),
    openAiSettings: () => openAiSettingsView(),
    openPluginStore: () => openPluginStoreView(),
    openPluginManager: () => openPluginManagerView(),
    openBackgroundPlugins: () => openBackgroundPluginsView(),
    openTaskScheduler: () => openTaskSchedulerView(),
    openLogViewer: () => openLogViewerView()
  })

  // macOS: 监听 dock 图标点击事件
  if (process.platform === 'darwin') {
    app.on('activate', handleAppActivate)
  }

  // 注册 IPC 处理器
  registerAllHandlers(
    getMainWindow,
    pluginManager,
    pluginWindowManager,
    themeManager,
    appSettingsManager,
    appShortcutManager,
    clipboardHistoryManager,
    systemPluginWindowManager,
    systemPageWindowManager
  )

  createWindow()

  setHotKeySettingRedirectHandler((cmdLabel?: string) => {
    openCommandShortcutSettingsView(cmdLabel)
  })

  trayMenuWindowManager = new TrayMenuWindowManager({
    pluginManager,
    settingsManager: appSettingsManager,
    themeManager,
    showMainWindow,
    openSettings: openSettingsView,
    openAiSettings: openAiSettingsView,
    openPluginManager: openPluginManagerView,
    openBackgroundPlugins: openBackgroundPluginsView,
    openTaskScheduler: openTaskSchedulerView,
    openPluginStore: openPluginStoreView,
    resetMainWindowPosition,
    reloadPlugins: async () => {
      await pluginManager.init()
    },
    restartMainProcess,
    quitMainProcess
  })

  appTrayManager = new AppTrayManager(
    () => appSettingsManager.getSettings(),
    {
      toggleMainWindow: toggleWindow,
      openMainWindow: showMainWindow,
      openTrayMenu: (anchorBounds) => {
        void trayMenuWindowManager?.toggle(anchorBounds)
      },
      restartApp: restartMainProcess,
      quitApp: quitMainProcess
    }
  )
  const trayCreated = appTrayManager.create()
  if (!trayCreated) {
    console.warn('[AppTray] Tray unavailable, fallback to global shortcuts.')
  }

  // 设置全局窗口提供者，用于系统对话框打开时临时隐藏窗口
  setWindowsProvider(() => {
    const windows: BrowserWindow[] = []
    if (mainWindow && !mainWindow.isDestroyed()) windows.push(mainWindow)
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
    if (panelWin && !panelWin.isDestroyed()) windows.push(panelWin)
    const systemPageWin = systemPageWindowManager.getAttachedWindow()
    if (systemPageWin && !systemPageWin.isDestroyed()) windows.push(systemPageWin)
    return windows
  })

  // 设置主窗口到插件窗口管理器
  pluginWindowManager.setMainWindow(mainWindow!)
  systemPluginWindowManager.setMainWindow(mainWindow!)
  systemPageWindowManager.setMainWindow(mainWindow!)

  // 设置主题管理器到插件窗口管理器
  pluginWindowManager.setThemeManager(themeManager)
  systemPageWindowManager.setThemeManager(themeManager)

  // 注册主窗口到主题管理器
  themeManager.registerWindow(mainWindow!)

  // 设置窗口管理器到插件管理器
  pluginManager.setWindowManager(pluginWindowManager)
  pluginManager.setSystemPluginWindowManager(systemPluginWindowManager)

  appShortcutManager.apply(appSettingsManager.getSettings().shortcuts)

  // 绑定 plugin tools 变更监听器到注册中心
  pluginManager.setPluginToolsListener((event, pluginId, pluginName, tools) => {
    if (event === 'remove') {
      pluginToolRegistry.removePlugin(pluginId)
    } else {
      pluginToolRegistry.refreshPlugin(pluginId, pluginName, tools)
    }
  })

  // 初始化插件管理器
  await pluginManager.init()

  // 预热系统应用搜索索引，降低冷启动首搜延迟（仅在启用搜索本机应用时执行）
  if (appSettingsManager.getSettings().search.enableApps) {
    pluginDesktop.warmupAppSearchIndex()
  }
})

app.on('window-all-closed', () => {
  if (isQuitting) {
    return
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  isQuitting = true
  flushMainWindowStateSave()
  app.removeListener('second-instance', handleSecondInstance)
  if (process.platform === 'darwin') {
    app.removeListener('activate', handleAppActivate)
  }

  if (hasShutdownCompleted) {
    return
  }

  event.preventDefault()

  if (shutdownFinalizeScheduled) {
    return
  }
  shutdownFinalizeScheduled = true

  void shutdownMainProcessResources()
    .catch((error) => {
      console.error('[Main] Shutdown cleanup failed:', error)
    })
    .finally(() => {
      if (shouldRestartAfterQuit) {
        app.relaunch()
      }
      app.quit()
    })
})

app.on('will-quit', () => {
  app.removeListener('second-instance', handleSecondInstance)
  if (process.platform === 'darwin') {
    app.removeListener('activate', handleAppActivate)
  }

  try {
    appTrayManager?.destroy()
  } catch (error) {
    console.error('[Main] Failed to destroy app tray manager on will-quit:', error)
  } finally {
    appTrayManager = null
  }

  try {
    trayMenuWindowManager?.destroy()
  } catch (error) {
    console.error('[Main] Failed to destroy tray menu window manager on will-quit:', error)
  } finally {
    trayMenuWindowManager = null
  }

  try {
    globalShortcut.unregisterAll()
  } catch (error) {
    console.error('[Main] Failed to unregister global shortcuts on will-quit:', error)
  }
})
