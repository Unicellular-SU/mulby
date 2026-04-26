import { app, BrowserWindow, globalShortcut, crashReporter } from 'electron'
import { registerAllHandlers } from './ipc'
import { setAiCapabilityPolicyResolver, setAiToolExecutor, setAiPluginToolResolver, setAiSkillActivationScopeManager } from './ai'
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
import { setWindowsProvider, setHasDetachedWindowsProvider } from './services/blur-manager'
import { appSettingsManager } from './services/app-settings'
import { AppShortcutManager } from './services/app-shortcuts'
import { InputHookService } from './services/input-hook'
import { AppTrayManager } from './services/app-tray'
import { TrayMenuWindowManager } from './services/tray-menu-window'
import { ActionMenuWindowManager } from './services/action-menu-window-manager'
import { ClipboardWatcher } from './services/clipboard-watcher-v2'
import { ClipboardHistoryManager } from './services/clipboard-history'
import { commandRunnerService } from './services/command-runner'
import { initAutoUpdater } from './services/update-center'
import { setLoggerMinLevel } from './services/logger'
import { SystemPluginWindowManager } from './services/system-plugin-window-manager'
import {
  SystemPageWindowManager,
  type OpenSystemPagePayload as OpenSystemPageWindowPayload,
  type SettingsCenterSection
} from './services/system-page-window-manager'
import { OnboardingWindowManager } from './services/onboarding-window'
import { onActiveWindowChange } from './services/active-window'
import { patchConsoleWithTimestamp } from '../shared/utils/console'
import { createOpenClawNodeService, type OpenClawNodeService } from './openclaw'
import { registerOpenClawHandlers } from './ipc/openclaw'
import { createMcpServerManager, type McpServerManager } from './ai/mcp-server'
import { registerMcpServerHandlers } from './ipc/mcp-server'
import { SuperPanelManager } from './services/super-panel-manager'
import { DeepLinkRouter } from './services/deep-link'
import { PluginInstaller } from './plugin/installer'
import { PluginStoreService } from './plugin/store-service'
import { MainWindowManager, isWindowAvailable } from './main-window-manager'
import { shutdownMainProcessResources, isShutdownComplete, type ShutdownResources } from './app-shutdown'
import log from 'electron-log'

patchConsoleWithTimestamp()

const APP_DISPLAY_NAME = 'Mulby'
const WINDOWS_APP_USER_MODEL_ID = 'com.mulby.app'

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
log.info('[CrashReporter] 崩溃报告器已启动，dump 目录:', app.getPath('crashDumps'))

let appTrayManager: AppTrayManager | null = null
let trayMenuWindowManager: TrayMenuWindowManager | null = null
let isQuitting = false
let shouldRestartAfterQuit = false
let shutdownFinalizeScheduled = false
let mcpServerManager: McpServerManager | null = null
let _inputHookService: InputHookService | null = null
let _openclawService: OpenClawNodeService | null = null
let _superPanelManager: SuperPanelManager | null = null
let deepLinkRouter: DeepLinkRouter | null = null
let pendingDeepLinkUrl: string | null = null
let lastDeepLinkTime: number = 0
const pluginManager = new PluginManager()
const pluginWindowManager = new PluginWindowManager()
const themeManager = new ThemeManager()
const mainWindowManager = new MainWindowManager()
setUiDialogThemeResolver(() => themeManager.getActualTheme())

// 注入插件对话框的窗口解析器，使插件调用 dialog API 时能找到正确的 parent window
import { setPluginDialogWindowResolver } from './plugin/dialog'
setPluginDialogWindowResolver((pluginId) => pluginWindowManager.getPluginWindow(pluginId))
setLoggerMinLevel(appSettingsManager.getSettings().developer.logLevel)
const clipboardWatcher = new ClipboardWatcher()
const clipboardHistoryManager = new ClipboardHistoryManager()
const systemPluginWindowManager = new SystemPluginWindowManager()
const systemPageWindowManager = new SystemPageWindowManager()
const onboardingWindowManager = new OnboardingWindowManager()
const actionMenuWindowManager = new ActionMenuWindowManager(themeManager)
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
      envKeys: plugin?.manifest.permissions?.envKeys,
    }
  }
})

// 创建 Plugin Tools 注册中心并注入到 AI 管道
const pluginToolRegistry = new PluginToolRegistry()
setAiPluginToolResolver(() => {
  const disabledList = appSettingsManager.getSettings().aiTooling.disabledPluginTools || []
  return pluginToolRegistry.resolveToolsForAi(new Set(disabledList))
})
setAiSkillActivationScopeManager({
  create: (requestId) => aiInternalToolRuntime.createActivationScope(requestId),
  cleanup: (requestId) => aiInternalToolRuntime.cleanupActivationScope(requestId)
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

const handleSecondInstance = (_event: Electron.Event, argv: string[]) => {
  if (isQuitting) return

  const deepLinkUrl = argv.find(arg => arg.startsWith('mulby://'))
  if (deepLinkUrl) {
    lastDeepLinkTime = Date.now()
    log.info('[DeepLink] 从 second-instance 收到链接:', deepLinkUrl)
    if (deepLinkRouter) {
      void deepLinkRouter.handleUrl(deepLinkUrl)
    } else {
      pendingDeepLinkUrl = deepLinkUrl
    }
    return
  }

  const mainWindow = mainWindowManager.getWindow()
  if (!isWindowAvailable(mainWindow)) {
    if (app.isReady()) {
      mainWindowManager.show()
    } else {
      void app.whenReady().then(() => { if (!isQuitting) mainWindowManager.show() })
    }
    return
  }
  try {
    if (!mainWindow.isVisible()) {
      mainWindowManager.toggle()
    } else {
      mainWindow.focus()
    }
  } catch (error) {
    log.warn('[Main] Failed to focus existing window on second-instance:', error)
  }
}

const handleAppActivate = () => {
  if (isQuitting) return
  try { app.show() } catch (error) {
    log.warn('[Main] Failed to restore app state on activate:', error)
  }

  const detachedWindows = pluginWindowManager.getAllDetachedWindows()
  if (detachedWindows.length > 0) {
    for (const win of detachedWindows) {
      if (!isWindowAvailable(win)) continue
      try {
        if (!win.isVisible()) win.show()
        if (win.isMinimized()) win.restore()
        win.focus()
      } catch (error) {
        log.warn('[Main] Failed to restore detached window on activate:', error)
      }
    }
    return
  }

  const systemDetached = systemPageWindowManager.getDetachedWindow()
  if (systemDetached && isWindowAvailable(systemDetached)) {
    try {
      if (!systemDetached.isVisible()) systemDetached.show()
      if (systemDetached.isMinimized()) systemDetached.restore()
      systemDetached.focus()
      return
    } catch (error) {
      log.warn('[Main] Failed to restore system page window on activate:', error)
    }
  }

  mainWindowManager.show()
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
        envKeys: plugin?.manifest.permissions?.envKeys,
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

    // 检查该工具是否被用户禁用
    const disabledList = appSettingsManager.getSettings().aiTooling.disabledPluginTools || []
    const toolKey = `${pluginId}:${toolName}`
    if (disabledList.includes(toolKey)) {
      throw new Error(`Plugin tool is disabled by user: ${toolKey}`)
    }

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

function getShutdownResources(): ShutdownResources {
  return {
    clipboardHistoryManager,
    clipboardWatcher,
    pluginManager,
    mcpServerManager: mcpServerManager ?? undefined,
    openclawService: _openclawService ?? undefined,
    superPanelManager: _superPanelManager ?? undefined,
    inputHookService: _inputHookService ?? undefined,
    pluginWindowManager,
    systemPageWindowManager,
    actionMenuWindowManager,
    appTrayManager: appTrayManager ?? undefined,
    trayMenuWindowManager: trayMenuWindowManager ?? undefined
  }
}

// 注册 mulby:// 自定义协议（必须在 requestSingleInstanceLock 之前）
if (!app.isPackaged) {
  // 开发模式：需要传入可执行文件路径，且必须使用绝对应用路径（防止外部拉起时工作目录错误）
  app.setAsDefaultProtocolClient('mulby', process.execPath, [app.getAppPath()])
} else {
  app.setAsDefaultProtocolClient('mulby')
}
log.info('[DeepLink] 已注册 mulby:// 协议')

// macOS: 通过 open-url 事件接收 deep link（包括首次启动和已运行时）
app.on('open-url', (event, url) => {
  event.preventDefault()
  lastDeepLinkTime = Date.now()
  log.info('[DeepLink] macOS open-url 事件:', url)
  if (deepLinkRouter) {
    void deepLinkRouter.handleUrl(url)
  } else {
    // 路由器尚未就绪，缓存待处理
    pendingDeepLinkUrl = url
  }
})

// Windows/Linux 冷启动: deep link URL 通过 process.argv 传入（首次启动时 second-instance 不触发）
if (process.platform !== 'darwin') {
  const coldStartUrl = process.argv.find(arg => arg.startsWith('mulby://'))
  if (coldStartUrl) {
    log.info('[DeepLink] 冷启动 process.argv 中发现链接:', coldStartUrl)
    pendingDeepLinkUrl = coldStartUrl
  }
}

// 单实例锁：确保只有一个应用实例运行
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  isQuitting = true
  app.quit()
} else {
  // 当第二个实例启动时，聚焦到已有窗口或处理 deep link
  app.on('second-instance', handleSecondInstance)
}


function getMainWindow() {
  return mainWindowManager.getWindow()
}

function showMainWindow(options?: { skipAutoPaste?: boolean }) {
  mainWindowManager.show(options)
}

function toggleWindow() {
  mainWindowManager.toggle()
}


function openSystemPageView(payload: OpenSystemPageWindowPayload) {
  const detached = systemPageWindowManager.getDetachedWindow()
  if (!detached) {
    showMainWindow()
  }
  void systemPageWindowManager.openAttached(payload)
}

function openSettingsView(section: SettingsCenterSection = 'dashboard') {
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

/**
 * 初始化 Deep Link 路由器
 *
 * 必须在 pluginManager.init() 完成后调用，
 * 因为路由器需要访问插件管理器和商店服务。
 */
function initDeepLinkRouter() {
  const installer = new PluginInstaller()
  const storeService = new PluginStoreService(pluginManager, installer)

  deepLinkRouter = new DeepLinkRouter({
    pluginManager,
    storeService,
    openSystemPage: (page, options) => {
      openSystemPageView({
        page: page as import('./services/system-page-window-manager').SystemPageId,
        settingsSection: options?.settingsSection as SettingsCenterSection,
        detailsPluginId: options?.detailsPluginId
      })
    },
    showMainWindow,
    fillSearch: (query) => {
      const mainWin = getMainWindow()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('app:setSearchText', query)
      }
    }
  })

  log.info('[DeepLink] 路由器已初始化')

  // 处理在路由器就绪之前缓存的挂起 URL
  if (pendingDeepLinkUrl) {
    const url = pendingDeepLinkUrl
    pendingDeepLinkUrl = null
    log.info('[DeepLink] 处理挂起的链接:', url)
    void deepLinkRouter.handleUrl(url)
  }
}


function resetMainWindowPosition() {
  mainWindowManager.resetPosition()
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
  log.info(`[ClipboardWatcher] Started - Mode: ${clipboardWatcher.isNativeMode() ? 'Native (zero overhead)' : 'Polling (fallback)'}`)

  // 启动活跃窗口监听器
  onActiveWindowChange(() => {})
  log.info('[ActiveWindowWatcher] Started permanently')

  // 启动剪贴板历史记录管理器
  clipboardHistoryManager.start()
  log.info('[ClipboardHistory] Started')

  // 设置剪贴板历史管理器到插件管理器
  pluginManager.setClipboardHistoryManager(clipboardHistoryManager)

  // 底层输入钩子服务（统一管理键盘/鼠标/双击修饰键）
  const inputHookService = new InputHookService()
  _inputHookService = inputHookService

  const appShortcutManager = new AppShortcutManager({
    actions: {
      toggleWindow: () => toggleWindow(),
      openSettings: () => openSettingsView()
    },
    onStatusChange: (status) => {
      // 后台重试成功后，推送快捷键状态到所有渲染窗口
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('settings:shortcutStatus:changed', status)
        }
      }
    },
    inputHook: inputHookService
  })

  // macOS: 监听 dock 图标点击事件
  if (process.platform === 'darwin') {
    app.on('activate', handleAppActivate)
  }

  // 注册 IPC 处理器
  const ipcHooks = registerAllHandlers(
    getMainWindow,
    pluginManager,
    pluginWindowManager,
    themeManager,
    appSettingsManager,
    appShortcutManager,
    clipboardHistoryManager,
    systemPluginWindowManager,
    systemPageWindowManager,
    onboardingWindowManager,
    actionMenuWindowManager,
    pluginToolRegistry
  )

  // 创建 OpenClaw Node 服务并注册 IPC
  let openclawService: OpenClawNodeService | null = null
  try {
    const hostManager = pluginManager.getHostManager()
    openclawService = createOpenClawNodeService({
      runCommand: (input, context) => commandRunnerService.runCommand(input, context),
      getPluginList: () => pluginManager.getAll().map((p) => ({
        id: p.id,
        name: p.manifest.displayName || p.manifest.name,
        description: p.manifest.description,
        version: p.manifest.version || '0.0.0',
        enabled: p.enabled
      })),
      invokePlugin: async (pluginId: string, method: string, args: unknown[]) => {
        const plugin = pluginManager.get(pluginId)
        if (!plugin) throw new Error(`Plugin not found: ${pluginId}`)
        if (!plugin.enabled) throw new Error(`Plugin is disabled: ${pluginId}`)

        // 检测是否是 AI Tool
        const isAiTool = plugin.manifest.tools?.some((t) => t.name === method)

        if (isAiTool) {
          // 初始化插件环境
          await pluginManager.initializePlugin(pluginId)
          const inited = await hostManager.initPlugin(plugin)
          if (!inited) {
            throw new Error(`Failed to initialize host for plugin: ${pluginId}`)
          }
          // 调用插件注册的 AI Tool 接口 (api.tools.register)
          // callHostMethod 返回 { success, data, error? } 信封，需要解包
          const toolMethodName = `__plugin_tool__${method}`
          const envelope = await hostManager.callHostMethod(pluginId, toolMethodName, args) as {
            success: boolean
            data?: unknown
            error?: string
          }
          if (!envelope.success) {
            throw new Error(envelope.error ?? `Plugin tool '${method}' execution failed`)
          }
          return envelope.data
        }

        // 回退兼容：执行标准插件 Feature
        return await pluginManager.run(pluginId, method, args[0] as string | undefined)
      },
      searchDesktop: async (query: string, limit: number) => {
        const results = await pluginDesktop.searchApps(query, limit)
        return results.map((r) => ({
          name: r.name,
          path: r.path,
          type: r.kind
        }))
      },
      searchFiles: async (query: string, limit: number) => {
        const results = await pluginDesktop.searchFiles(query, limit)
        return results.map((r) => ({
          name: r.name,
          path: r.path,
          type: r.isDirectory ? 'directory' : 'file'
        }))
      },
      searchPlugins: async (query: string) => {
        const results = await pluginManager.search({ text: query, attachments: [] })
        return results.map((r) => ({
          pluginId: r.plugin.id,
          pluginName: r.plugin.manifest.name,
          displayName: r.plugin.manifest.displayName || r.plugin.manifest.name,
          featureCode: r.feature.code,
          featureExplain: r.feature.explain,
          matchType: r.matchType
        }))
      },
      runPlugin: async (pluginId: string, featureCode: string, input?: string) => {
        return pluginManager.run(pluginId, featureCode, input)
      },
      getAiTools: () => {
        const disabledList = appSettingsManager.getSettings().aiTooling.disabledPluginTools || []
        return pluginToolRegistry.resolveToolsForAi(new Set(disabledList))
      },
      resolveOriginalPluginId: (sanitizedId) => pluginToolRegistry.resolveOriginalPluginId(sanitizedId),
      isToolDisabled: (pluginId, toolName) => {
        const disabledList = appSettingsManager.getSettings().aiTooling.disabledPluginTools || []
        return disabledList.includes(`${pluginId}:${toolName}`)
      },
      canvas: { getMainWindow }
    })

    registerOpenClawHandlers({
      openclawService,
      settingsManager: appSettingsManager
    })

    // 注册 deviceToken 持久化回调：将 Gateway 返回的 token 保存到 AppSettings
    openclawService.setSaveDeviceTokenCallback((token: string) => {
      log.info('[OpenClaw] 保存 device token')
      const currentSettings = appSettingsManager.getSettings()
      void appSettingsManager.updateSettings({
        openclaw: {
          ...currentSettings.openclaw,
          auth: {
            ...currentSettings.openclaw.auth,
            deviceToken: token
          }
        }
      })
      // [P1] 同步传播到活跃客户端，避免重连时丢失 auth
      openclawService?.updateSettings({
        ...currentSettings.openclaw,
        auth: {
          ...currentSettings.openclaw.auth,
          deviceToken: token
        }
      })
    })

    // 自动连接逻辑推迟到 pluginManager.init() 之后执行（见下方调用处）
    // 确保 pluginToolRegistry 已填充，消除 Gateway 一次性发现工具时的竞争窗口

    // 将引用提升到模块级变量，供 shutdownMainProcessResources 清理
    _openclawService = openclawService
    log.info('[OpenClaw] Node 服务初始化完成')
  } catch (err) {
    log.error('[OpenClaw] Node 服务初始化失败:', err)
  }

  // 创建 MCP Server Manager（将插件工具暴露给外部 AI 工具）
  try {
    mcpServerManager = createMcpServerManager({
      getAppVersion: () => app.getVersion(),
      pluginToolRegistry,
      pluginManager,
      getDisabledPluginTools: () => appSettingsManager.getSettings().aiTooling.disabledPluginTools || [],
      getMcpServerConfig: () => appSettingsManager.getSettings().mcpServer,
      updateMcpServerConfig: (partial) => {
        const current = appSettingsManager.getSettings()
        const next = appSettingsManager.updateSettings({
          mcpServer: {
            ...current.mcpServer,
            ...partial
          }
        })
        return next.mcpServer
      },
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath
    })
    registerMcpServerHandlers(mcpServerManager)
    // 当用户在 UI 中切换工具禁用状态时，同步刷新 MCP Server 工具列表
    ipcHooks.setOnDisabledPluginToolsChanged(() => {
      mcpServerManager?.refreshTools()
    })
    log.info('[MCP-Server] Manager 初始化完成')
  } catch (err) {
    log.error('[MCP-Server] Manager 初始化失败:', err)
  }

  function initMainWindow() {
    mainWindowManager.setDeps({
      pluginWindowManager,
      systemPageWindowManager,
      getTrayMenuManager: () => trayMenuWindowManager,
      clipboardWatcher,
      getLastDeepLinkTime: () => lastDeepLinkTime
    })
    mainWindowManager.create()
    const mainWindow = mainWindowManager.getWindow()!

    mainWindow.on('closed', () => {
      systemPluginWindowManager.setMainWindow(null)
      systemPageWindowManager.setMainWindow(null)
    })

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
      log.warn('[AppTray] Tray unavailable, fallback to global shortcuts.')
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

    // 设置全局独立窗口状态检测函数，用于对话框关闭时判断是否恢复隐藏 Dock
    setHasDetachedWindowsProvider(() => {
      return pluginWindowManager.getAllDetachedWindows().length > 0 || Boolean(systemPageWindowManager.getDetachedWindow())
    })

    // 设置主窗口到插件窗口管理器
    pluginWindowManager.setMainWindow(mainWindow!)
    systemPluginWindowManager.setMainWindow(mainWindow!)
    systemPageWindowManager.setMainWindow(mainWindow!)

    // 设置主题管理器到插件窗口管理器
    pluginWindowManager.setThemeManager(themeManager)
    pluginWindowManager.prewarmAttachedShell()
    systemPageWindowManager.setThemeManager(themeManager)

    // 注册主窗口到主题管理器
    themeManager.registerWindow(mainWindow!)

    pluginManager.setWindowManager(pluginWindowManager)
    pluginManager.setSystemPluginWindowManager(systemPluginWindowManager)

    // 注入系统页面打开回调（供内置系统插件的「打开设置/商店」等命令使用）
    pluginManager.setSystemPageOpenHandler((page: string) => {
      openSystemPageView({ page: page as import('../main/services/system-page-window-manager').SystemPageId })
    })

    appShortcutManager.apply(appSettingsManager.getSettings().shortcuts)
    // 应用鼠标触发和双击修饰键的初始设置
    appShortcutManager.applyMouseTrigger(appSettingsManager.getSettings().mouseTrigger)
    appShortcutManager.applyDoubleTap(appSettingsManager.getSettings().doubleTap)

    // 初始化超级面板管理器
    const superPanelManager = new SuperPanelManager(
      inputHookService,
      pluginManager,
      appSettingsManager,
      themeManager,
      clipboardHistoryManager,
      { getMainWindow: () => mainWindowManager.getWindow() }
    )
    _superPanelManager = superPanelManager
    superPanelManager.enable()
    log.info('[SuperPanel] 管理器已初始化')

    // 注册超级面板设置变更回调
    ipcHooks.setOnSuperPanelChanged(() => {
      superPanelManager.enable() // enable() 内部会读取最新设置并自动处理启用/禁用
    })

    // 绑定 plugin tools 变更监听器到注册中心
    pluginManager.setPluginToolsListener((event, pluginId, pluginName, tools) => {
      if (event === 'remove') {
        pluginToolRegistry.removePlugin(pluginId)
      } else {
        pluginToolRegistry.refreshPlugin(pluginId, pluginName, tools)
      }
      // 通知 MCP Server 刷新工具列表
      mcpServerManager?.refreshTools()
    })

    // 给宿主进程管理器注入「有活跃 UI 窗口」检测回调
    // 有窗口时不触发 idle 销毁，保证用户操作连贯性
    const hostManager = pluginManager.getHostManager()
    hostManager.hasActiveWindow = (pluginId: string): boolean => {
      // 检查面板窗口（主窗口内嵌插件）
      const panelPlugin = pluginWindowManager.getPanelWindow()?.getCurrentPlugin()
      if (panelPlugin?.id === pluginId) return true
      // 检查所有独立窗口（detached / auxiliary）
      return pluginWindowManager.getAllDetachedWindows().some(
        (win) => pluginWindowManager.getPluginByWindow(win)?.id === pluginId
      )
    }


    // 初始化自动更新检查器（仅在生产环境下启用）
    if (app.isPackaged) {
      initAutoUpdater()
    }
  }

  // 检查是否需要显示引导窗口
  const needsOnboarding = !appSettingsManager.getSettings().onboardingCompleted
  if (needsOnboarding) {
    log.info('[Onboarding] 首次启动，显示引导窗口')
    onboardingWindowManager.setThemeManager(themeManager)
    onboardingWindowManager.onComplete(() => {
      log.info('[Onboarding] 引导完成，初始化并展示主窗口')
      initMainWindow()
      showMainWindow()
      // 初始化插件管理器
      pluginManager.init().then(() => {
        // 预热系统应用搜索索引
        if (appSettingsManager.getSettings().search.enableApps) {
          pluginDesktop.warmupAppSearchIndex()
        }
        // 预热 feature 图标缓存（必须在 init 完成后）
        ipcHooks.warmupFeatureIconCache()
        // pluginToolRegistry 已填充，现在才安全触发 OpenClaw 自动连接
        if (openclawService) {
          const s = appSettingsManager.getSettings()
          if (s.openclaw.enabled && s.openclaw.node.autoConnect) {
            log.info('[OpenClaw] 插件初始化完成，自动连接...')
            void openclawService.connect(s.openclaw).catch((err: unknown) => {
              log.error('[OpenClaw] 自动连接失败:', err)
            })
          }
        }
        if (mcpServerManager) {
          const mcpConfig = appSettingsManager.getSettings().mcpServer
          if (mcpConfig.enabled) {
            log.info('[MCP-Server] 插件初始化完成，自动启动...')
            void mcpServerManager.start().catch((err: unknown) => {
              log.error('[MCP-Server] 自动启动失败:', err)
            })
          }
        }
        // 初始化 Deep Link 路由器
        initDeepLinkRouter()
      })
    })
    void onboardingWindowManager.show()
  } else {
    // 正常启动流程
    initMainWindow()

    // 初始化插件管理器
    await pluginManager.init()

    // 预热系统应用搜索索引，降低冷启动首搜延迟（仅在启用搜索本机应用时执行）
    if (appSettingsManager.getSettings().search.enableApps) {
      pluginDesktop.warmupAppSearchIndex()
    }

    // 预热 feature 图标缓存（必须在 init 完成后，getEnabled() 才有数据）
    ipcHooks.warmupFeatureIconCache()

    // pluginToolRegistry 已填充，现在才安全触发 OpenClaw 自动连接
    if (openclawService) {
      const s = appSettingsManager.getSettings()
      if (s.openclaw.enabled && s.openclaw.node.autoConnect) {
        log.info('[OpenClaw] 插件初始化完成，自动连接...')
        void openclawService.connect(s.openclaw).catch((err: unknown) => {
          log.error('[OpenClaw] 自动连接失败:', err)
        })
      }
    }

    if (mcpServerManager) {
      const mcpConfig = appSettingsManager.getSettings().mcpServer
      if (mcpConfig.enabled) {
        log.info('[MCP-Server] 插件初始化完成，自动启动...')
        void mcpServerManager.start().catch((err: unknown) => {
          log.error('[MCP-Server] 自动启动失败:', err)
        })
      }
    }

    // 初始化 Deep Link 路由器
    initDeepLinkRouter()
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
  mainWindowManager.flushStateSave()
  app.removeListener('second-instance', handleSecondInstance)
  if (process.platform === 'darwin') {
    app.removeListener('activate', handleAppActivate)
  }

  if (isShutdownComplete()) return

  event.preventDefault()

  if (shutdownFinalizeScheduled) return
  shutdownFinalizeScheduled = true

  void shutdownMainProcessResources(getShutdownResources())
    .catch((error) => {
      log.error('[Main] Shutdown cleanup failed:', error)
    })
    .finally(() => {
      if (shouldRestartAfterQuit) app.relaunch()
      app.quit()
    })
})

app.on('will-quit', () => {
  app.removeListener('second-instance', handleSecondInstance)
  if (process.platform === 'darwin') {
    app.removeListener('activate', handleAppActivate)
  }

  try { appTrayManager?.destroy() } catch (error) {
    log.error('[Main] Failed to destroy tray on will-quit:', error)
  } finally { appTrayManager = null }

  try { trayMenuWindowManager?.destroy() } catch (error) {
    log.error('[Main] Failed to destroy tray menu on will-quit:', error)
  } finally { trayMenuWindowManager = null }

  try { globalShortcut.unregisterAll() } catch (error) {
    log.error('[Main] Failed to unregister shortcuts on will-quit:', error)
  }
})
