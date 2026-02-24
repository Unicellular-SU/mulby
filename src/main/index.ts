import { app, BrowserWindow, globalShortcut, screen, crashReporter } from 'electron'
import http from 'http'
import https from 'https'
import { join } from 'path'
import { registerAllHandlers } from './ipc'
import { setAiCapabilityPolicyResolver, setAiToolExecutor } from './ai'
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
import { pluginDesktop } from './plugin/desktop'
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
import { patchConsoleWithTimestamp } from '../shared/utils/console'

patchConsoleWithTimestamp()

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
  productName: 'Mulby',
  companyName: 'Mulby',
  submitURL: '', // 不上传，只保存本地
  uploadToServer: false,
  ignoreSystemCrashHandler: false
})
console.log('[CrashReporter] 崩溃报告器已启动，dump 目录:', app.getPath('crashDumps'))

let mainWindow: BrowserWindow | null = null
let appTrayManager: AppTrayManager | null = null
let trayMenuWindowManager: TrayMenuWindowManager | null = null
let isQuitting = false
const pluginManager = new PluginManager()
const pluginWindowManager = new PluginWindowManager()
const themeManager = new ThemeManager()
setUiDialogThemeResolver(() => themeManager.getActualTheme())
const clipboardWatcher = new ClipboardWatcher()
const clipboardHistoryManager = new ClipboardHistoryManager()
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

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
    const message = String(error.message || '').toLowerCase()
    return message.includes('abort') || message.includes('cancelled') || message.includes('canceled')
  }
  const message = String(error || '').toLowerCase()
  return message.includes('abort') || message.includes('cancelled') || message.includes('canceled')
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

  const pluginName = context?.pluginName
  if (!pluginName) {
    throw new Error('AI tool execution requires plugin context')
  }
  const hostManager = pluginManager.getHostManager()
  const result = await hostManager.callHostMethod(pluginName, name, [args])

  // 解包 host 返回的结果：{ success: true, data: {...} } -> {...}
  if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
    return (result as any).data
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

// 单实例锁：确保只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  isQuitting = true
  app.quit()
} else {
  // 当第二个实例启动时，聚焦到已有窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        toggleWindow()
      } else {
        mainWindow.focus()
      }
    }
  })
}

function getMainWindow() {
  return mainWindow
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return

  trayMenuWindowManager?.hide()
  pluginWindowManager.hidePanelWindow()
  mainWindow.hide()

  // macOS: 如果有独立窗口，确保 dock 图标保持显示
  if (process.platform === 'darwin' && app.dock) {
    const hasDetachedWindows = pluginWindowManager.getAllDetachedWindows().length > 0
    if (hasDetachedWindows) {
      void app.dock.show()
    }
  }
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
  // 默认宽度 800
  const width = settings.window?.width || 800

  mainWindow = new BrowserWindow({
    width,
    height: 62,
    show: false,
    frame: false,
    resizable: true, // 允许用户调整大小
    minHeight: 62,   // 锁定初始高度
    maxHeight: 62,
    minWidth: 400,   // 设置最小宽度
    skipTaskbar: true,
    transparent: true,
    hasShadow: false, // 透明窗口禁用原生阴影，由 CSS box-shadow 控制
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

  mainWindow.once('ready-to-show', () => {
    // console.log('[Main] Window ready-to-show event fired')
  })

  // 默认关闭行为：隐藏到托盘（显式退出时除外）
  mainWindow.on('close', (event) => {
    const closeToTray = appSettingsManager.getSettings().tray.closeToTray
    if (isQuitting || !closeToTray) {
      return
    }
    event.preventDefault()
    hideMainWindow()
  })

  // 失焦隐藏（类似 uTools 的交互）
  mainWindow.on('blur', () => {
    if (isIgnoringBlur()) return

    // 延迟检查，让焦点转移完成
    setTimeout(() => {
      // 如果焦点转移到了面板窗口，不隐藏
      const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
      if (panelWin && panelWin.isFocused()) {
        return
      }
      // 焦点转移到其他地方，隐藏主窗口和面板
      pluginWindowManager.hidePanelWindow()
      mainWindow?.hide()
    }, 50)
  })

  // 状态保存防抖
  let saveTimer: NodeJS.Timeout | null = null
  const saveState = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const bounds = mainWindow.getBounds()
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
    }, 500)
  }

  // 监听窗口调整和移动
  mainWindow.on('resize', saveState)
  mainWindow.on('move', saveState)

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
  trayMenuWindowManager?.hide()

  // 每次显示前都强制重置关键属性，确保窗口行为正确
  if (process.platform === 'darwin') {
    try {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      mainWindow.setAlwaysOnTop(true, 'floating')

      // 如果有独立窗口，在显示主窗口之前先确保 dock 图标显示
      // 并且设置一个短暂的延迟，确保 dock 状态稳定
      const hasDetachedWindows = pluginWindowManager.getAllDetachedWindows().length > 0
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
    // 优先使用保存的位置
    const settings = appSettingsManager.getSettings()
    if (settings.window?.x !== undefined && settings.window?.y !== undefined) {
      mainWindow.setPosition(settings.window.x, settings.window.y)
    } else {
      // 获取当前鼠标所在的显示器
      const cursorPoint = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursorPoint)
      const { width: screenWidth, height: screenHeight } = display.workAreaSize
      const { x: screenX, y: screenY } = display.workArea

      // 计算窗口位置：水平居中，垂直方向在屏幕 1/5 处
      const windowBounds = mainWindow.getBounds()
      const x = screenX + Math.round((screenWidth - windowBounds.width) / 2)
      const y = screenY + Math.round(screenHeight / 5)

      mainWindow.setPosition(x, y)
    }

    // 临时忽略 blur 事件，防止 show/focus 过程中误触发
    startIgnoringBlur()

    mainWindow.show()
    mainWindow.focus()

    // 恢复之前隐藏的面板
    pluginWindowManager.showPanelWindow()

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
    console.error('Error in show sequence:', e)
  }
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  if (mainWindow.isVisible()) {
    hideMainWindow()
  } else {
    showMainWindow()
  }
}

function openSettingsView() {
  showMainWindow()
  mainWindow?.webContents.send('app:openSettings')
}

function openPluginStoreView() {
  showMainWindow()
  mainWindow?.webContents.send('app:openPluginStore')
}

function openPluginManagerView() {
  showMainWindow()
  mainWindow?.webContents.send('app:openPluginManager')
}

function openAiSettingsView() {
  showMainWindow()
  mainWindow?.webContents.send('app:openAiSettings')
}

function openBackgroundPluginsView() {
  showMainWindow()
  mainWindow?.webContents.send('app:openBackgroundPlugins')
}

function openTaskSchedulerView() {
  showMainWindow()
  mainWindow?.webContents.send('app:openTaskScheduler')
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
  isQuitting = true
  app.relaunch()
  app.exit(0)
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
    openPluginStore: () => openPluginStoreView(),
    openPluginManager: () => openPluginManagerView()
  })

  // macOS: 监听 dock 图标点击事件
  if (process.platform === 'darwin') {
    app.on('activate', () => {
      // 先调用 app.show() 恢复应用状态
      app.show()

      // 点击 dock 图标时，显示所有隐藏的独立窗口
      const detachedWindows = pluginWindowManager.getAllDetachedWindows()
      if (detachedWindows.length > 0) {
        detachedWindows.forEach(win => {
          if (!win.isDestroyed() && !win.isVisible()) {
            win.show()
          }
          if (!win.isDestroyed() && win.isMinimized()) {
            win.restore()
          }
          if (!win.isDestroyed()) {
            win.focus()
          }
        })
      } else {
        // 如果没有独立窗口，显示主窗口
        showMainWindow()
      }
    })
  }

  // 注册 IPC 处理器
  registerAllHandlers(
    getMainWindow,
    pluginManager,
    pluginWindowManager,
    themeManager,
    appSettingsManager,
    appShortcutManager,
    clipboardHistoryManager
  )

  createWindow()

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
    return windows
  })

  // 设置主窗口到插件窗口管理器
  pluginWindowManager.setMainWindow(mainWindow!)

  // 设置主题管理器到插件窗口管理器
  pluginWindowManager.setThemeManager(themeManager)

  // 注册主窗口到主题管理器
  themeManager.registerWindow(mainWindow!)

  // 设置窗口管理器到插件管理器
  pluginManager.setWindowManager(pluginWindowManager)

  // 初始化插件管理器
  await pluginManager.init()

  // 预热系统应用搜索索引，降低冷启动首搜延迟
  pluginDesktop.warmupAppSearchIndex()

  appShortcutManager.apply(appSettingsManager.getSettings().shortcuts)
})

app.on('window-all-closed', () => {
  if (isQuitting) {
    return
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  appTrayManager?.destroy()
  trayMenuWindowManager?.destroy()
  globalShortcut.unregisterAll()
})
