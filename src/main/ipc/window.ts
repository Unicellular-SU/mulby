import { app, ipcMain, BrowserWindow, webContents, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { PluginWindowManager } from '../plugin/window'
import { ThemeManager } from '../services/theme'
import { PluginManager } from '../plugin/manager'
import { AppSettingsManager } from '../services/app-settings'
import { getMainWindowVisibleBounds, getMainWindowWindowSize } from '../main-window-frame'
import { InputPayload, Plugin, PluginFeature } from '../../shared/types/plugin'
import {
  setSubInputState,
  clearSubInputState,
  isSubInputEnabled,
  getSubInputOwnerId
} from '../services/subinput-state'
import { shouldUseWindowsFramelessSurface } from '../services/window-surface'
import { windowFromWebContents, getPluginWebContents } from '../services/webcontents-registry'
import { hasDetachedWindows, markAppHidden, shouldHideWholeAppAfterWindowHide } from '../services/blur-manager'
import { ActionMenuWindowManager } from '../services/action-menu-window-manager'
import log from 'electron-log'
import { getPinnedSize, updatePinnedSize } from '../services/window-size-pin'

// 重新导出 clearSubInputState 供其他模块使用
export { clearSubInputState } from '../services/subinput-state'

function isInputPayload(payload: unknown): payload is InputPayload {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as InputPayload
  return typeof candidate.text === 'string' && Array.isArray(candidate.attachments)
}

export function registerWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
  pluginWindowManager: PluginWindowManager,
  themeManager: ThemeManager,
  appSettingsManager: AppSettingsManager,
  pluginManager: PluginManager | undefined,
  actionMenuWindowManager: ActionMenuWindowManager,
  refreshMacDockPresentation?: () => void
) {
  const toMainWindowWindowSize = (width: number, height: number) => getMainWindowWindowSize(width, height)

  const resolveCurrentPlugin = (win: BrowserWindow | null): Plugin | null => {
    if (!win) return null

    const mainWin = getMainWindow()
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
    if (win === mainWin || win === panelWin) {
      return pluginWindowManager.getPanelWindow()?.getCurrentPlugin()
        ?? pluginWindowManager.getAttachedPlugin()?.plugin
        ?? null
    }

    return pluginWindowManager.getPluginByWindow(win)
  }

  const resolveCurrentLaunchTarget = (win: BrowserWindow | null) => {
    if (!win) return null

    const mainWin = getMainWindow()
    if (win === mainWin) {
      const attached = pluginWindowManager.getAttachedPlugin()
      if (!attached) return null
      return {
        plugin: attached.plugin,
        featureCode: attached.featureCode,
        mode: 'attached' as const
      }
    }

    return pluginWindowManager.getLaunchTargetByWindow(win)
  }

  const terminatePluginForWindow = async (win: BrowserWindow | null): Promise<{ success: boolean; error?: string }> => {
    if (!pluginManager) {
      return { success: false, error: '插件管理器未初始化' }
    }

    const plugin = resolveCurrentPlugin(win)
    if (!plugin) {
      return { success: false, error: '没有正在运行的插件' }
    }

    return pluginManager.stopPlugin(plugin.id, false)
  }

  const reloadPluginWindow = (
    senderWin: BrowserWindow,
    source: 'menu' | 'ipc' = 'menu'
  ): boolean => {
    if (senderWin.isDestroyed()) return false

    const reloadStart = Date.now()
    const mainWin = getMainWindow()
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
    const targetWin = senderWin === mainWin && panelWin ? panelWin : senderWin
    if (!targetWin || targetWin.isDestroyed()) return false

    const pluginWc = getPluginWebContents(targetWin) ?? targetWin.webContents
    if (pluginWc.isDestroyed()) return false

    const useWindowsFramelessSurface = shouldUseWindowsFramelessSurface()
    log.info(
      `[ReloadTrace] reload requested | source=${source} | senderWin=${senderWin.id} | targetWin=${targetWin.id} | isPanel=${targetWin === panelWin} | wcId=${pluginWc.id}`
    )
    log.info(
      `[ReloadTrace] pluginWc state | isLoading=${pluginWc.isLoading()} | url=${pluginWc.getURL().slice(0, 80)}`
    )

    // 附着面板是透明无边框窗口。直接 reload 偶发会让 Chromium 留下一层未重绘的白板，
    // 直到下一次用户交互才刷新，所以所有入口都必须走统一的重绘保护逻辑。
    const isDark = themeManager.getActualTheme() === 'dark'
    targetWin.setBackgroundColor(isDark ? '#1e293b' : '#ffffff')
    targetWin.setOpacity(0)
    log.info(`[ReloadTrace] opacity set to 0 | +${Date.now() - reloadStart}ms`)

    const finishListenerCount = pluginWc.listenerCount('did-finish-load')
    log.info(`[ReloadTrace] did-finish-load listeners BEFORE adding: ${finishListenerCount}`)

    const cleanup = () => {
      pluginWc.removeListener('did-finish-load', onFinishLoad)
      pluginWc.removeListener('did-fail-load', onFailLoad)
    }

    const restoreSurface = (reason: 'did-finish-load' | 'did-fail-load') => {
      setTimeout(() => {
        if (targetWin.isDestroyed()) return
        if (useWindowsFramelessSurface) {
          targetWin.setBackgroundColor('#00000000')
        }
        if (!pluginWc.isDestroyed()) {
          pluginWc.send('theme:changed', themeManager.getActualTheme())
          pluginWc.invalidate()
        }
        if (!targetWin.webContents.isDestroyed()) {
          targetWin.webContents.invalidate()
        }
        targetWin.setOpacity(1)
        // macOS 的透明窗口在快速 opacity 切换后偶发保留旧合成层；
        // hide()+showInactive() 可以强制整窗重新合成。
        if (process.platform === 'darwin' && !targetWin.isDestroyed()) {
          targetWin.hide()
          targetWin.showInactive()
        }
        log.info(`[ReloadTrace] surface restored after ${reason} | +${Date.now() - reloadStart}ms`)
      }, 50)
    }

    const onFinishLoad = () => {
      log.info(`[ReloadTrace] onFinishLoad fired | +${Date.now() - reloadStart}ms`)
      cleanup()
      restoreSurface('did-finish-load')
    }

    const onFailLoad = () => {
      log.warn(`[ReloadTrace] onFailLoad fired | +${Date.now() - reloadStart}ms`)
      cleanup()
      restoreSurface('did-fail-load')
    }

    pluginWc.on('did-finish-load', onFinishLoad)
    pluginWc.on('did-fail-load', onFailLoad)

    log.info(
      `[ReloadTrace] calling pluginWc.reload() | +${Date.now() - reloadStart}ms | listeners AFTER adding: ${pluginWc.listenerCount('did-finish-load')}`
    )
    pluginWc.reload()
    log.info(`[ReloadTrace] pluginWc.reload() returned | +${Date.now() - reloadStart}ms`)
    return true
  }

  // =========================================
  // SubInput 子输入框 API
  // =========================================

  // 设置子输入框（只允许附着模式的插件使用）
  ipcMain.handle('subInput:set', (event, placeholder?: string, isFocus?: boolean) => {
    const mainWin = getMainWindow()
    if (!mainWin) return false

    // 检查调用者是否为面板窗口（附着模式）
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
    const callerWin = windowFromWebContents(event.sender)
    if (!panelWin || callerWin !== panelWin) {
      log.warn('[SubInput] Rejected: SubInput is only available in attached mode')
      return false
    }

    const placeholderText = placeholder || '请输入...'
    setSubInputState({
      enabled: true,
      placeholder: placeholderText,
      ownerId: event.sender.id
    })

    // 通知主窗口切换到 SubInput 模式
    mainWin.webContents.send('subInput:enabled', {
      placeholder: placeholderText,
      isFocus: isFocus !== false
    })

    return true
  })

  // 移除子输入框
  ipcMain.handle('subInput:remove', (event) => {
    const mainWin = getMainWindow()
    if (!mainWin) return false

    // 只有拥有者才能移除
    const ownerId = getSubInputOwnerId()
    if (ownerId !== event.sender.id && ownerId !== 0) {
      return false
    }

    clearSubInputState()
    mainWin.webContents.send('subInput:disabled')
    return true
  })

  // 设置子输入框值
  ipcMain.on('subInput:setValue', (_event, text: string) => {
    const mainWin = getMainWindow()
    mainWin?.webContents.send('subInput:setValue', text)
  })

  // 子输入框获取焦点
  ipcMain.on('subInput:focus', () => {
    const mainWin = getMainWindow()
    if (mainWin) {
      // 先聚焦主窗口，确保输入框能真正获得焦点
      mainWin.focus()
      mainWin.webContents.send('subInput:focus')
    }
  })

  // 子输入框失去焦点
  ipcMain.on('subInput:blur', () => {
    const mainWin = getMainWindow()
    mainWin?.webContents.send('subInput:blur')
  })

  // 子输入框选中全部文本
  ipcMain.on('subInput:select', () => {
    const mainWin = getMainWindow()
    if (mainWin) {
      // 先聚焦主窗口，确保全选后用户可以直接输入
      mainWin.focus()
      mainWin.webContents.send('subInput:select')
    }
  })

  // 子输入框输入变化（由主窗口发送，转发给插件）
  ipcMain.on('subInput:change', (_event, text: string) => {
    if (!isSubInputEnabled()) return
    const ownerId = getSubInputOwnerId()
    if (ownerId === 0) return

    // 找到拥有者 webContents 并发送
    const owner = webContents.fromId(ownerId)
    if (owner && !owner.isDestroyed()) {
      owner.send('subInput:onChange', { text })
    }
  })

  // =========================================
  // 插件导航 API
  // =========================================

  // 跳转到另一个插件
  ipcMain.handle('plugin:redirect', async (event, label: string | [string, string], payload?: unknown) => {
    if (!pluginManager) return false

    let pluginName: string
    let featureCode: string

    if (Array.isArray(label)) {
      [pluginName, featureCode] = label
    } else {
      // 单独的指令名称，查找所有拥有该指令的插件
      featureCode = label
      const plugins = pluginManager.getEnabled()
      const matched = plugins.filter((p: Plugin) =>
        p.manifest.features?.some((f: PluginFeature) => f.code === featureCode || f.cmds?.some(c => {
          if (typeof c === 'string') return c === featureCode
          if (typeof c === 'object' && 'label' in c) return c.label === featureCode
          return false
        }))
      )

      if (matched.length === 0) return false
      if (matched.length > 1) {
        // 多个匹配，返回候选列表让用户选择
        return { candidates: matched.map(p => ({ name: p.id, displayName: p.manifest.displayName })) }
      }
      pluginName = matched[0].id
    }

    // 执行插件
    const plugin = pluginManager.getAll().find((p: Plugin) => p.id === pluginName)
    if (!plugin) return false

    const input = isInputPayload(payload)
      ? payload
      : (typeof payload === 'string' ? payload : JSON.stringify(payload || ''))

    // 初始化 Host 进程（确保插件出现在任务管理器中）
    if (plugin.manifest.ui) {
      try {
        const hostManager = pluginManager.getHostManager()
        const hostReady = await hostManager.initPlugin(plugin)
        if (!hostReady) {
          log.warn(`[redirect] Failed to init host for plugin ${pluginName}, continuing anyway`)
        }
      } catch (err) {
        log.error(`[redirect] Error initializing host for plugin ${pluginName}:`, err)
      }
    }

    // 判断调用源是附着模式还是独立模式
    const callerWin = windowFromWebContents(event.sender)
    const mainWin = getMainWindow()
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()

    const isAttachedContext = (callerWin && mainWin && callerWin === mainWin) ||
      (callerWin && panelWin && callerWin === panelWin)

    const forceDetached = pluginManager.getAlwaysOpenDetached(plugin.id)?.enabled === true

    if (isAttachedContext && !forceDetached) {
      // 附着模式 -> 保持附着模式跳转
      return pluginWindowManager.attachPlugin(plugin, featureCode, isInputPayload(input) ? input : { text: input, attachments: [] })
    } else {
      // 独立模式 -> 打开新的独立窗口
      const newWin = pluginWindowManager.createDetachedWindow(plugin, featureCode, isInputPayload(input) ? input : { text: input, attachments: [] })
      return !!newWin
    }
  })

  // 退出插件
  ipcMain.handle('plugin:out', async (event, isKill?: boolean) => {
    const win = windowFromWebContents(event.sender)
    const mainWin = getMainWindow()

    if (!win) return false

    // 清理 SubInput 状态
    if (getSubInputOwnerId() === event.sender.id) {
      clearSubInputState()
      mainWin?.webContents.send('subInput:disabled')
    }

    if (isKill) {
      const result = await terminatePluginForWindow(win)
      if (result.success) return true

      log.warn(`[plugin:out] terminate fallback: ${result.error || 'unknown error'}`)
      if (win === mainWin || win === pluginWindowManager.getPanelWindow()?.getWindow()) {
        pluginWindowManager.closeAttached(true)
      } else {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('plugin:out', true)
        }
        win.destroy()
      }
    } else if (win === mainWin || win === pluginWindowManager.getPanelWindow()?.getWindow()) {
      // 附着模式，普通关闭允许 PluginWindowManager 决定是否进入 resident-ui。
      pluginWindowManager.closeAttached(false)
    } else {
      // 独立窗口普通退出必须走 close 路径
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('plugin:out', false)
      }
      win.close()
    }

    return true
  })

  ipcMain.handle('plugin:terminateCurrent', async (event) => {
    const win = windowFromWebContents(event.sender)
    return terminatePluginForWindow(win)
  })

  ipcMain.handle('plugin:showAttachedMenu', async (event, point?: { x?: unknown; y?: unknown }) => {
    const win = windowFromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false

    const plugin = resolveCurrentPlugin(win)
    const launchTarget = resolveCurrentLaunchTarget(win)
    const launchOnStartup = launchTarget && pluginManager
      ? pluginManager.getLaunchOnStartup(launchTarget.plugin.id)
      : undefined
    const alwaysOpenDetached = plugin && pluginManager
      ? pluginManager.getAlwaysOpenDetached(plugin.id)
      : undefined
    return actionMenuWindowManager.show({
      ownerWindow: win,
      anchor: point,
      items: [
        { id: 'reload', label: '重新加载界面', disabled: !plugin },
        {
          id: 'toggle-launch-on-startup',
          label: '跟随 Mulby 启动',
          checked: launchOnStartup?.enabled === true,
          disabled: !(launchTarget && pluginManager)
        },
        {
          id: 'toggle-always-open-detached',
          label: '始终以独立窗口运行',
          checked: alwaysOpenDetached?.enabled === true,
          disabled: !(plugin && pluginManager && plugin.manifest.ui)
        },
        { id: 'separator-main', label: '', separator: true },
        { id: 'terminate', label: '结束运行', danger: true, disabled: !(plugin && pluginManager) }
      ],
      onSelect: async (id) => {
        if (id === 'reload') {
          reloadPluginWindow(win)
          return
        }
        if (id === 'toggle-launch-on-startup') {
          if (!launchTarget || !pluginManager) return
          const current = pluginManager.getLaunchOnStartup(launchTarget.plugin.id)
          pluginManager.setLaunchOnStartup(
            launchTarget.plugin.id,
            current?.enabled !== true,
            {
              featureCode: launchTarget.featureCode,
              mode: launchTarget.mode
            }
          )
          return
        }
        if (id === 'toggle-always-open-detached') {
          if (!plugin || !pluginManager || !plugin.manifest.ui) return
          const current = pluginManager.getAlwaysOpenDetached(plugin.id)
          pluginManager.setAlwaysOpenDetached(plugin.id, current?.enabled !== true)
          return
        }
        if (id === 'terminate') {
          const result = await terminatePluginForWindow(win)
          if (!result.success) {
            log.warn(`[plugin-menu] terminate failed: ${result.error || 'unknown error'}`)
          }
        }
      }
    })
  })

  ipcMain.handle('titlebar:showPluginMenu', async (event, point?: { x?: unknown; y?: unknown }) => {
    const win = windowFromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false

    const plugin = resolveCurrentPlugin(win)
    const launchTarget = resolveCurrentLaunchTarget(win)
    const launchOnStartup = launchTarget && pluginManager
      ? pluginManager.getLaunchOnStartup(launchTarget.plugin.id)
      : undefined
    const alwaysOpenDetached = plugin && pluginManager
      ? pluginManager.getAlwaysOpenDetached(plugin.id)
      : undefined
    return actionMenuWindowManager.show({
      ownerWindow: win,
      anchor: point,
      items: [
        { id: 'reload', label: '重新加载界面', disabled: !plugin },
        {
          id: 'toggle-launch-on-startup',
          label: '跟随 Mulby 启动',
          checked: launchOnStartup?.enabled === true,
          disabled: !(launchTarget && pluginManager)
        },
        {
          id: 'toggle-always-open-detached',
          label: '始终以独立窗口运行',
          checked: alwaysOpenDetached?.enabled === true,
          disabled: !(plugin && pluginManager && plugin.manifest.ui)
        },
        { id: 'separator-titlebar', label: '', separator: true },
        { id: 'terminate', label: '结束运行', danger: true, disabled: !(plugin && pluginManager) }
      ],
      onSelect: async (id) => {
        if (id === 'reload') {
          reloadPluginWindow(win)
          return
        }
        if (id === 'toggle-launch-on-startup') {
          if (!launchTarget || !pluginManager) return
          const current = pluginManager.getLaunchOnStartup(launchTarget.plugin.id)
          pluginManager.setLaunchOnStartup(
            launchTarget.plugin.id,
            current?.enabled !== true,
            {
              featureCode: launchTarget.featureCode,
              mode: launchTarget.mode
            }
          )
          return
        }
        if (id === 'toggle-always-open-detached') {
          if (!plugin || !pluginManager || !plugin.manifest.ui) return
          const current = pluginManager.getAlwaysOpenDetached(plugin.id)
          pluginManager.setAlwaysOpenDetached(plugin.id, current?.enabled !== true)
          return
        }
        if (id === 'terminate') {
          const result = await terminatePluginForWindow(win)
          if (!result.success) {
            log.warn(`[titlebar] terminate failed: ${result.error || 'unknown error'}`)
          }
        }
      }
    })
  })

  // =========================================
  // 窗口间通信 API
  // =========================================

  // 向父窗口发送消息
  ipcMain.on('window:sendToParent', (event, channel: string, ...args: unknown[]) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return

    // 获取此窗口的直接父窗口 ID
    const parentId = pluginWindowManager.getParentWindowId(win.id)

    if (parentId) {
      // 有明确的父窗口，只发给父窗口的插件内容（而非标题栏）
      const parentWin = BrowserWindow.fromId(parentId)
      if (parentWin && !parentWin.isDestroyed()) {
        const parentPluginWc = getPluginWebContents(parentWin)
        const targetWc = parentPluginWc ?? parentWin.webContents
        targetWc.send('window:childMessage', channel, ...args)
      }
    } else {
      // 没有父窗口（可能是面板或第一级独立窗口）
      // 只发给同插件的面板窗口
      const plugin = pluginWindowManager.getPluginByWindow(win)
      const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
      const panelPlugin = pluginWindowManager.getPanelWindow()?.getCurrentPlugin()

      if (panelWin && plugin && panelPlugin?.id === plugin.id && win.id !== panelWin.id) {
        const panelPluginWc = getPluginWebContents(panelWin)
        const targetWc = panelPluginWc ?? panelWin.webContents
        targetWc.send('window:childMessage', channel, ...args)
      }
    }
  })

  // =========================================
  // 窗口工具 API
  // =========================================

  // 获取窗口类型
  ipcMain.handle('window:getType', (event) => {
    const win = windowFromWebContents(event.sender)
    const mainWin = getMainWindow()
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()

    if (win === mainWin) return 'main'
    if (win === panelWin) return 'main' // Panel 也算主窗口的一部分

    // 检查是否为 'browser' 类型 (通过 createBrowserWindow 创建的辅助窗口)
    // 目前暂无法通过公开 API 准确区分 auxiliary window 和 feature detached window
    // 统一返回 'detach'
    return 'detach'
  })

  // 修正：我们需要准确区分。
  // 一种方法是依靠 preload 发送的参数？不安全。
  // 让我们暂时保持 returns 'detach'，因为修改 PluginWindowManager 需要额外步骤。
  // 或者我们可以只依赖 createBrowserWindow 返回的 proxy对象来认知它是 browser window。
  // 实际上，对于 window:getType，主要用于前端区分。

  // 让我们先把 window:child:action 加上。

  ipcMain.handle('window:child:action', (event, childId: number, action: string, ...args: unknown[]) => {
    const callerWin = windowFromWebContents(event.sender)
    if (!callerWin) return null

    const callerPlugin = pluginWindowManager.getPluginByWindow(callerWin)
    if (!callerPlugin) return null

    const allDetached = pluginWindowManager.getAllDetachedWindows()
    const childWin = allDetached.find(w => w.id === childId)
    if (!childWin || childWin.isDestroyed()) return null

    const childPlugin = pluginWindowManager.getPluginByWindow(childWin)
    if (!childPlugin || childPlugin.id !== callerPlugin.id) return null

    switch (action) {
      case 'show':
        childWin.show()
        break
      case 'hide':
        childWin.hide()
        break
      case 'close':
        childWin.close()
        break
      case 'destroy':
        childWin.destroy()
        break
      case 'focus':
        childWin.focus()
        break
      case 'showInactive':
        childWin.showInactive()
        break
      case 'setTitle':
        {
          const title = String(args[0] ?? '')
          childWin.setTitle(title)
          if (!childWin.webContents.isDestroyed()) {
            childWin.webContents.send('titlebar:titleChanged', title)
          }
        }
        break
      case 'setSize':
        if (typeof args[0] === 'number' && typeof args[1] === 'number') {
          childWin.setSize(args[0], args[1])
          updatePinnedSize(childWin.id, args[0], args[1])
        }
        break
      case 'setPosition':
        if (typeof args[0] === 'number' && typeof args[1] === 'number') {
          const pinned = process.platform === 'win32' ? getPinnedSize(childWin.id) : undefined
          if (pinned) {
            childWin.setBounds({ x: Math.round(args[0]), y: Math.round(args[1]), width: pinned.width, height: pinned.height })
          } else {
            childWin.setPosition(args[0], args[1])
          }
        }
        break
      case 'setBounds':
        if (args[0] && typeof args[0] === 'object') {
          const bounds = args[0] as { x?: number; y?: number; width?: number; height?: number }
          const current = childWin.getBounds()
          const nextW = Number.isFinite(bounds.width) ? Math.max(1, Math.round(bounds.width!)) : current.width
          const nextH = Number.isFinite(bounds.height) ? Math.max(1, Math.round(bounds.height!)) : current.height
          childWin.setBounds({
            x: Number.isFinite(bounds.x) ? Math.round(bounds.x!) : current.x,
            y: Number.isFinite(bounds.y) ? Math.round(bounds.y!) : current.y,
            width: nextW,
            height: nextH
          })
          updatePinnedSize(childWin.id, nextW, nextH)
        }
        break
      case 'getBounds':
        return childWin.getBounds()
      case 'setOpacity':
        if (typeof args[0] === 'number') {
          childWin.setOpacity(Math.max(0, Math.min(1, args[0])))
        }
        break
      case 'setBackgroundThrottling':
        if (typeof args[0] === 'boolean') {
          const childPluginWc = getPluginWebContents(childWin) ?? childWin.webContents
          if (!childPluginWc.isDestroyed()) {
            childPluginWc.setBackgroundThrottling(args[0])
          }
        }
        break
      case 'setIgnoreMouseEvents':
        if (typeof args[0] === 'boolean') {
          const opts = (args[1] && typeof args[1] === 'object') ? args[1] as { forward?: boolean } : undefined
          childWin.setIgnoreMouseEvents(args[0], opts)
        }
        break
      case 'setAlwaysOnTop':
        if (typeof args[0] === 'boolean') {
          const level = typeof args[1] === 'string' ? args[1] as Parameters<BrowserWindow['setAlwaysOnTop']>[1] : undefined
          childWin.setAlwaysOnTop(args[0], level)
        }
        break
      case 'setVisibleOnAllWorkspaces':
        if (typeof args[0] === 'boolean') {
          const opts = (args[1] && typeof args[1] === 'object') ? args[1] as { visibleOnFullScreen?: boolean } : undefined
          childWin.setVisibleOnAllWorkspaces(args[0], opts)
        }
        break
      case 'setFullScreen':
        if (typeof args[0] === 'boolean') {
          childWin.setFullScreen(args[0])
        }
        break
      case 'postMessage':
        {
          const childPluginWc = getPluginWebContents(childWin) ?? childWin.webContents
          childPluginWc.send('window:childMessage', String(args[0] ?? ''), ...args.slice(1))
        }
        break
      default:
        log.warn(`Unknown child action: ${action}`)
    }
    return true
  })

  // 设置展开高度（仅调整高度，宽度保持不变）
  // 合并短时间内的连续调用，防止透明 NSPanel 窗口因高频 resize 导致合成器异常
  let pendingExpendHeight: { win: BrowserWindow; height: number; allowResize: boolean } | null = null
  let expendHeightTimer: ReturnType<typeof setTimeout> | null = null
  const EXPEND_HEIGHT_DEBOUNCE_MS = 16
  let lastAppliedHeight = -1
  let lastAppliedAllowResize = false

  function invalidateAfterResize(win: BrowserWindow, beforeBounds: { width: number; height: number }): void {
    if (win.isDestroyed() || win.webContents.isDestroyed() || !win.isVisible()) return

    const afterBounds = win.getBounds()
    if (afterBounds.width === beforeBounds.width && afterBounds.height === beforeBounds.height) {
      return
    }

    setImmediate(() => {
      if (win.isDestroyed() || win.webContents.isDestroyed() || !win.isVisible()) return
      win.webContents.invalidate()
    })
  }

  function applyExpendHeight(win: BrowserWindow, height: number, allowResize: boolean): void {
    if (win.isDestroyed()) return

    if (height === lastAppliedHeight && allowResize === lastAppliedAllowResize) {
      return
    }

    lastAppliedHeight = height
    lastAppliedAllowResize = allowResize

    const mainWin = getMainWindow()
    const beforeBounds = win.getBounds()
    if (win === mainWin) {
      if (allowResize) {
        const settings = appSettingsManager.getSettings()
        const savedWidth = settings.window?.width || 800
        const savedHeight = settings.window?.height && settings.window.height >= 500
          ? settings.window.height
          : height
        const minSize = toMainWindowWindowSize(800, 500)
        const maxSize = toMainWindowWindowSize(9999, 9999)
        const nextSize = toMainWindowWindowSize(savedWidth, savedHeight)

        win.setMinimumSize(minSize.width, minSize.height)
        win.setMaximumSize(maxSize.width, maxSize.height)
        win.setSize(nextSize.width, nextSize.height)
        invalidateAfterResize(win, beforeBounds)
      } else {
        const visibleBounds = getMainWindowVisibleBounds(win.getBounds())
        const minSize = toMainWindowWindowSize(400, height)
        const maxSize = toMainWindowWindowSize(9999, height)
        const nextSize = toMainWindowWindowSize(visibleBounds.width, height)

        win.setMinimumSize(minSize.width, minSize.height)
        win.setMaximumSize(maxSize.width, maxSize.height)
        win.setSize(nextSize.width, nextSize.height)
        invalidateAfterResize(win, beforeBounds)
      }
    } else {
      const [width] = win.getSize()
      win.setSize(width, height)
    }
  }

  ipcMain.on('window:setExpendHeight', (event, height: number, allowResize?: boolean) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return

    pendingExpendHeight = { win, height, allowResize: allowResize === true }
    if (!expendHeightTimer) {
      expendHeightTimer = setTimeout(() => {
        expendHeightTimer = null
        if (pendingExpendHeight) {
          const { win: w, height: h, allowResize: ar } = pendingExpendHeight
          pendingExpendHeight = null
          applyExpendHeight(w, h, ar)
        }
      }, EXPEND_HEIGHT_DEBOUNCE_MS)
    }
  })

  ipcMain.on('window:invalidate', (event) => {
    const win = windowFromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return

    setImmediate(() => {
      if (win.isDestroyed() || win.webContents.isDestroyed() || !win.isVisible()) return
      win.webContents.invalidate()
    })
  })


  // 页面内查找
  ipcMain.handle('webContents:findInPage', (event, text: string, options?: {
    forward?: boolean
    findNext?: boolean
    matchCase?: boolean
  }) => {
    const requestId = event.sender.findInPage(text, options)
    return requestId
  })

  // 停止页面内查找
  ipcMain.on('webContents:stopFindInPage', (event, action?: 'clearSelection' | 'keepSelection' | 'activateSelection') => {
    event.sender.stopFindInPage(action || 'clearSelection')
  })

  // 原生文件拖拽
  ipcMain.on('window:startDrag', (event, filePath: string | string[]) => {
    const paths = Array.isArray(filePath) ? filePath : [filePath]
    if (paths.length === 0) return
    const targetPath = paths[0]
    if (!existsSync(targetPath)) {
      log.warn(`[window:startDrag] File not found: ${targetPath}`)
      return
    }
    const fallbackIcon = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOqz9uoAAAAASUVORK5CYII=',
        'base64'
      )
    )

    // Electron 要求提供 icon，优先用系统文件图标
    app.getFileIcon(targetPath, { size: 'small' }).then((icon) => {
      const dragIcon = icon?.isEmpty?.() ? fallbackIcon : icon
      if (!event.sender.isDestroyed()) {
        // 使用 file (单文件) 而不是 files，避免类型问题
        event.sender.startDrag({
          file: targetPath,
          files: paths,
          icon: dragIcon || fallbackIcon
        })
      }
    }).catch(() => {
      if (!event.sender.isDestroyed()) {
        event.sender.startDrag({
          file: targetPath,
          files: paths,
          icon: fallbackIcon
        })
      }
    })
  })

  // =========================================
  // 原有窗口 API（增强版）
  // =========================================

  ipcMain.on('window:hide', (event, isRestorePreWindow?: boolean) => {
    // 使用发送者窗口而非主窗口，以支持面板和独立窗口模式
    const win = windowFromWebContents(event.sender)
    if (!win) return

    // 如果是面板窗口，需要通过管理器隐藏
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
    if (panelWin && panelWin.id === win.id) {
      pluginWindowManager.hidePanelWindow()
    } else {
      win.hide()
    }

    // 焦点恢复：隐藏窗口后将系统焦点归还给之前的前台应用
    if (isRestorePreWindow && process.platform === 'darwin') {
      // app.hide() 会隐藏整个 Electron 应用的所有窗口，
      // 仅当没有其他可见窗口且没有独立窗口时才使用，避免误伤 Dock 表示。
      const hasOtherVisible = BrowserWindow.getAllWindows().some(
        w => !w.isDestroyed() && w.isVisible() && w.id !== win.id
      )
      if (shouldHideWholeAppAfterWindowHide({
        platform: process.platform,
        restorePreviousWindow: true,
        hasOtherVisibleWindows: hasOtherVisible,
        hasDetachedWindows: hasDetachedWindows()
      })) {
        app.hide()
        markAppHidden()
      }
    }
    if (process.platform === 'darwin' && hasDetachedWindows()) {
      setTimeout(() => refreshMacDockPresentation?.(), 50)
    }
    // Windows/Linux: 窗口隐藏后系统会自动将焦点转移给下一个可见窗口，
    // 无需额外操作
  })

  // 显示窗口
  ipcMain.on('window:show', (event) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return

    // 如果是面板窗口，通过管理器显示
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
    if (panelWin && panelWin.id === win.id) {
      pluginWindowManager.showPanelWindow()
    } else {
      win.show()
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  ipcMain.on('window:showInactive', (event) => {
    const win = windowFromWebContents(event.sender)
    if (!win || win.isDestroyed()) return

    win.showInactive()
  })

  ipcMain.on('window:setTitle', (event, title: string) => {
    const win = windowFromWebContents(event.sender)
    if (!win || win.isDestroyed()) return

    const normalizedTitle = String(title ?? '')
    win.setTitle(normalizedTitle)
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('titlebar:titleChanged', normalizedTitle)
    }
  })

  ipcMain.on('window:setSize', (event, width: number, height: number, allowResize?: boolean) => {
    // 使用发送者窗口而非主窗口，以支持面板和独立窗口模式
    const win = windowFromWebContents(event.sender)
    if (win) {
      const mainWin = getMainWindow()
      if (win === mainWin) {
        if (allowResize) {
          // 允许自由调整大小（用于系统页面）
          const minSize = toMainWindowWindowSize(800, 500)
          const maxSize = toMainWindowWindowSize(9999, 9999)
          win.setMinimumSize(minSize.width, minSize.height)
          win.setMaximumSize(maxSize.width, maxSize.height)
        } else {
          // 更新最小/最大高度限制，锁定高度但允许宽度调整
          const minSize = toMainWindowWindowSize(400, height)
          const maxSize = toMainWindowWindowSize(9999, height)
          win.setMinimumSize(minSize.width, minSize.height)
          win.setMaximumSize(maxSize.width, maxSize.height)
        }
        const nextSize = toMainWindowWindowSize(width, height)
        win.setSize(nextSize.width, nextSize.height)
        return
      }
      // 直接调整大小，无需切换 resizable 状态
      // setSize 在 macOS 上对无边框窗口也有效
      win.setSize(width, height)
      updatePinnedSize(win.id, width, height)
    }
  })

  ipcMain.on('window:center', (event) => {
    const win = windowFromWebContents(event.sender)
    win?.center()
  })

  // 分离插件为独立窗口
  ipcMain.on('plugin:detach', () => {
    pluginWindowManager.detachCurrent()
  })

  // 关闭当前插件
  ipcMain.on('plugin:close', (event) => {
    const win = windowFromWebContents(event.sender)
    if (win) {
      const mainWin = getMainWindow()
      if (win === mainWin) {
        pluginWindowManager.closeAttached()
      } else {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('plugin:out', false)
        }
        win.close()
      }
    }
  })

  // 窗口置顶
  ipcMain.on('window:alwaysOnTop', (event, flag: boolean, level?: string) => {
    const win = windowFromWebContents(event.sender)
    if (!win || typeof flag !== 'boolean') return

    const normalizedLevel = typeof level === 'string'
      ? level as Parameters<BrowserWindow['setAlwaysOnTop']>[1]
      : undefined
    win.setAlwaysOnTop(flag, normalizedLevel)
  })

  ipcMain.on('window:setIgnoreMouseEvents', (event, ignore: boolean, opts?: { forward?: boolean }) => {
    const win = windowFromWebContents(event.sender)
    if (!win || typeof ignore !== 'boolean') return

    const normalizedOpts = opts && typeof opts === 'object'
      ? { forward: opts.forward === true }
      : undefined
    win.setIgnoreMouseEvents(ignore, normalizedOpts)
  })

  ipcMain.on('window:setVisibleOnAllWorkspaces', (event, flag: boolean, opts?: { visibleOnFullScreen?: boolean }) => {
    const win = windowFromWebContents(event.sender)
    if (!win || typeof flag !== 'boolean') return

    const normalizedOpts = opts && typeof opts === 'object'
      ? { visibleOnFullScreen: opts.visibleOnFullScreen === true }
      : undefined
    win.setVisibleOnAllWorkspaces(flag, normalizedOpts)
  })

  ipcMain.on('window:setFullScreen', (event, flag: boolean) => {
    const win = windowFromWebContents(event.sender)
    if (!win || typeof flag !== 'boolean') return

    win.setFullScreen(flag)
  })

  // 窗口焦点请求 (multi-view focus fix for macOS)
  // 必须同时确保 BrowserWindow 是 key window 且 pluginView 拥有内部焦点
  ipcMain.on('window:requestFocus', (event) => {
    const win = windowFromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      log.info(`[requestFocus] FAILED: windowFromWebContents returned null for sender.id=${event.sender.id}`)
      return
    }

    const pluginWc = getPluginWebContents(win)
    const wasFocused = win.isFocused()

    if (!wasFocused) {
      // On macOS, frame:false + WebContentsView windows may fail win.focus().
      // Use win.show() which calls [NSWindow makeKeyAndOrderFront:] and
      // app.focus({steal:true}) to ensure the app is active.
      if (process.platform === 'darwin') {
        app.show()
        app.focus({ steal: true })
      }
      if (win.isMinimized()) {
        win.restore()
      }
      win.show()
      win.focus()
    }
    // 关键：即使 win 已 focused，pluginView 可能没有内部焦点
    if (pluginWc && !pluginWc.isDestroyed() && !pluginWc.isFocused()) {
      pluginWc.focus()
      log.info(`[requestFocus] called pluginWc.focus() for winId=${win.id}, now isFocused=${pluginWc.isFocused()}`)
    }
  })

  ipcMain.on('window:setPosition', (event, x: number, y: number) => {
    const win = windowFromWebContents(event.sender)
    if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return
    // On Windows, setPosition() on frameless windows causes cumulative size drift.
    // Use setBounds() with the pinned initial size to prevent accumulation.
    const pinned = process.platform === 'win32' ? getPinnedSize(win.id) : undefined
    if (pinned) {
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: pinned.width, height: pinned.height })
    } else {
      win.setPosition(Math.round(x), Math.round(y))
    }
  })

  ipcMain.handle('window:setBounds', (event, bounds: { x?: number; y?: number; width?: number; height?: number }) => {
    const win = windowFromWebContents(event.sender)
    if (!win || !bounds || typeof bounds !== 'object') return false

    const current = win.getBounds()
    const nextW = Number.isFinite(bounds.width) ? Math.max(1, Math.round(bounds.width!)) : current.width
    const nextH = Number.isFinite(bounds.height) ? Math.max(1, Math.round(bounds.height!)) : current.height
    win.setBounds({
      x: Number.isFinite(bounds.x) ? Math.round(bounds.x!) : current.x,
      y: Number.isFinite(bounds.y) ? Math.round(bounds.y!) : current.y,
      width: nextW,
      height: nextH
    })
    updatePinnedSize(win.id, nextW, nextH)
    return true
  })

  ipcMain.handle('window:getBounds', (event) => {
    const win = windowFromWebContents(event.sender)
    return win?.getBounds() ?? null
  })

  // 设置窗口透明度（0.0 ~ 1.0）
  ipcMain.handle('window:setOpacity', (event, opacity: number) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return
    // 值域校验：夹在 [0.0, 1.0] 范围内
    const clamped = Math.max(0, Math.min(1, opacity))
    win.setOpacity(clamped)
  })

  // 获取窗口透明度
  ipcMain.handle('window:getOpacity', (event) => {
    const win = windowFromWebContents(event.sender)
    return win?.getOpacity() ?? 1
  })

  ipcMain.handle('window:setBackgroundThrottling', (event, allowed: boolean) => {
    if (typeof allowed !== 'boolean' || event.sender.isDestroyed()) return false
    event.sender.setBackgroundThrottling(allowed)
    return true
  })

  // 获取插件模式
  ipcMain.handle('plugin:getMode', (event) => {
    const win = windowFromWebContents(event.sender)
    const mainWin = getMainWindow()
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
    return (win === mainWin || win === panelWin) ? 'attached' : 'detached'
  })

  // 最小化窗口
  ipcMain.on('window:minimize', (event) => {
    const win = windowFromWebContents(event.sender)
    win?.minimize()
  })

  // 最大化/还原窗口
  ipcMain.on('window:maximize', (event) => {
    const win = windowFromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  // 获取窗口状态
  ipcMain.handle('window:getState', (event) => {
    const win = windowFromWebContents(event.sender)
    return {
      isMaximized: win?.isMaximized() ?? false,
      isAlwaysOnTop: win?.isAlwaysOnTop() ?? false,
      opacity: win?.getOpacity() ?? 1
    }
  })

  // 重新加载插件
  ipcMain.on('window:resizeDrag', (event, payload: {
    edge: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
    startX: number
    startY: number
    currentX: number
    currentY: number
    baseBounds: { x: number; y: number; width: number; height: number }
  }) => {
    const win = windowFromWebContents(event.sender)
    if (!win || win.isDestroyed() || !win.isResizable()) return
    if (win.isMaximized() || win.isMinimized() || win.isFullScreen()) return

    const { edge, startX, startY, currentX, currentY, baseBounds } = payload ?? {}
    if (
      typeof edge !== 'string'
      || typeof startX !== 'number'
      || typeof startY !== 'number'
      || typeof currentX !== 'number'
      || typeof currentY !== 'number'
      || !baseBounds
      || typeof baseBounds.x !== 'number'
      || typeof baseBounds.y !== 'number'
      || typeof baseBounds.width !== 'number'
      || typeof baseBounds.height !== 'number'
    ) {
      return
    }

    const dx = currentX - startX
    const dy = currentY - startY
    const resizeLeft = edge.includes('left')
    const resizeRight = edge.includes('right')
    const resizeTop = edge.includes('top')
    const resizeBottom = edge.includes('bottom')

    let nextX = baseBounds.x
    let nextY = baseBounds.y
    let nextWidth = baseBounds.width
    let nextHeight = baseBounds.height

    if (resizeLeft) {
      nextX += dx
      nextWidth -= dx
    }
    if (resizeRight) {
      nextWidth += dx
    }
    if (resizeTop) {
      nextY += dy
      nextHeight -= dy
    }
    if (resizeBottom) {
      nextHeight += dy
    }

    const [minWidth, minHeight] = win.getMinimumSize()
    const [maxWidth, maxHeight] = win.getMaximumSize()
    const clampedWidth = Math.max(minWidth || 1, maxWidth > 0 ? Math.min(nextWidth, maxWidth) : nextWidth)
    const clampedHeight = Math.max(minHeight || 1, maxHeight > 0 ? Math.min(nextHeight, maxHeight) : nextHeight)

    if (resizeLeft) {
      nextX = baseBounds.x + (baseBounds.width - clampedWidth)
    }
    if (resizeTop) {
      nextY = baseBounds.y + (baseBounds.height - clampedHeight)
    }

    win.setBounds({
      x: Math.round(nextX),
      y: Math.round(nextY),
      width: Math.max(1, Math.round(clampedWidth)),
      height: Math.max(1, Math.round(clampedHeight))
    })
  })

  ipcMain.on('plugin:reload', (event) => {
    const senderWin = windowFromWebContents(event.sender)
    log.info(`[ReloadTrace] plugin:reload IPC received | senderWin=${senderWin?.id ?? 'null'}`)
    if (senderWin) {
      reloadPluginWindow(senderWin, 'ipc')
    }
  })

  // 创建新窗口
  ipcMain.handle('window:create', async (event, url: string, options) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return null

    const plugin = pluginWindowManager.getPluginByWindow(win)
    if (plugin) {
      const newWin = pluginWindowManager.createAuxiliaryWindow(plugin, url, options, win.id)
      return newWin ? newWin.id : null
    }
    return null
  })

}
