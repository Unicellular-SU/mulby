import { ipcMain, BrowserWindow, webContents, nativeImage } from 'electron'
import { PluginWindowManager } from '../plugin/window'
import { ThemeManager } from '../services/theme'
import { PluginManager } from '../plugin/manager'
import { Plugin, PluginFeature } from '../../shared/types/plugin'
import {
  setSubInputState,
  clearSubInputState,
  isSubInputEnabled,
  getSubInputOwnerId
} from '../services/subinput-state'

// 重新导出 clearSubInputState 供其他模块使用
export { clearSubInputState } from '../services/subinput-state'

export function registerWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
  pluginWindowManager: PluginWindowManager,
  themeManager: ThemeManager,
  pluginManager?: PluginManager
) {
  // =========================================
  // SubInput 子输入框 API
  // =========================================

  // 设置子输入框（只允许附着模式的插件使用）
  ipcMain.handle('subInput:set', (event, placeholder?: string, isFocus?: boolean) => {
    const mainWin = getMainWindow()
    if (!mainWin) return false

    // 检查调用者是否为面板窗口（附着模式）
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
    const callerWin = BrowserWindow.fromWebContents(event.sender)
    if (!panelWin || callerWin !== panelWin) {
      console.warn('[SubInput] Rejected: SubInput is only available in attached mode')
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
  ipcMain.handle('plugin:redirect', async (_event, label: string | [string, string], payload?: unknown) => {
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

    const input = typeof payload === 'string' ? payload : JSON.stringify(payload || '')
    pluginWindowManager.attachPlugin(plugin, featureCode, input)
    return true
  })

  // 退出插件
  ipcMain.handle('plugin:out', (event, isKill?: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const mainWin = getMainWindow()

    if (!win) return false

    // 清理 SubInput 状态
    if (getSubInputOwnerId() === event.sender.id) {
      clearSubInputState()
      mainWin?.webContents.send('subInput:disabled')
    }

    if (win === mainWin || win === pluginWindowManager.getPanelWindow()?.getWindow()) {
      // 附着模式，关闭插件
      pluginWindowManager.closeAttached()
    } else {
      // 独立窗口模式
      if (isKill) {
        win.destroy()
      } else {
        win.hide()
      }
    }

    return true
  })

  // =========================================
  // 窗口间通信 API
  // =========================================

  // 向父窗口发送消息
  ipcMain.on('window:sendToParent', (event, channel: string, ...args: unknown[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    // 获取父窗口（面板窗口或主窗口）
    const mainWin = getMainWindow()
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()

    // 如果当前窗口不是主窗口/面板，向它们发送消息
    if (win !== mainWin && mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('window:childMessage', channel, ...args)
    }
    if (win !== panelWin && panelWin && !panelWin.isDestroyed()) {
      panelWin.webContents.send('window:childMessage', channel, ...args)
    }
  })

  // =========================================
  // 窗口工具 API
  // =========================================

  // 获取窗口类型
  ipcMain.handle('window:getType', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const mainWin = getMainWindow()
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()

    if (win === mainWin) return 'main'
    if (win === panelWin) return 'main' // Panel 也算主窗口的一部分
    return 'detach' // 其他都是分离窗口
  })

  // 设置展开高度（仅调整高度，宽度保持不变）
  ipcMain.on('window:setExpendHeight', (event, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const [width] = win.getSize()
      win.setSize(width, height)
    }
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

    // 创建一个简单的空图标（Electron 要求必须提供 icon）
    const emptyIcon = nativeImage.createEmpty()
    // 使用 file (单文件) 而不是 files，避免类型问题
    event.sender.startDrag({
      file: paths[0],
      icon: emptyIcon
    })
  })

  // =========================================
  // 原有窗口 API（增强版）
  // =========================================

  ipcMain.on('window:hide', (event, _isRestorePreWindow?: boolean) => {
    // TODO: isRestorePreWindow 参数目前未使用，后续可实现焦点恢复逻辑
    // 使用发送者窗口而非主窗口，以支持面板和独立窗口模式
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    // 如果是面板窗口，需要通过管理器隐藏
    const panelWin = pluginWindowManager.getPanelWindow()?.getWindow()
    if (panelWin && panelWin.id === win.id) {
      pluginWindowManager.hidePanelWindow()
    } else {
      win.hide()
    }
  })

  // 显示窗口
  ipcMain.on('window:show', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
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

  ipcMain.on('window:setSize', (event, width: number, height: number) => {
    // 使用发送者窗口而非主窗口，以支持面板和独立窗口模式
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      // 直接调整大小，无需切换 resizable 状态
      // setSize 在 macOS 上对无边框窗口也有效
      win.setSize(width, height)
    }
  })

  ipcMain.on('window:center', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.center()
  })

  // 分离插件为独立窗口
  ipcMain.on('plugin:detach', () => {
    pluginWindowManager.detachCurrent()
  })

  // 关闭当前插件
  ipcMain.on('plugin:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const mainWin = getMainWindow()
      if (win === mainWin) {
        pluginWindowManager.closeAttached()
      } else {
        win.close()
      }
    }
  })

  // 窗口置顶
  ipcMain.on('window:alwaysOnTop', (event, flag: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.setAlwaysOnTop(flag)
  })

  // 获取插件模式
  ipcMain.handle('plugin:getMode', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const mainWin = getMainWindow()
    return win === mainWin ? 'attached' : 'detached'
  })

  // 最小化窗口
  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  // 最大化/还原窗口
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize()
    }
  })

  // 获取窗口状态
  ipcMain.handle('window:getState', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return {
      isMaximized: win?.isMaximized() ?? false,
      isAlwaysOnTop: win?.isAlwaysOnTop() ?? false
    }
  })

  // 重新加载插件
  ipcMain.on('plugin:reload', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      // 重载前设置背景色并隐藏窗口内容，避免闪白
      const isDark = themeManager.getActualTheme() === 'dark'
      const bgColor = isDark ? '#1e293b' : '#ffffff'
      win.setBackgroundColor(bgColor)
      win.setOpacity(0)

      // 监听加载完成事件
      const onFinishLoad = () => {
        // 延迟一点再显示，确保页面完全渲染
        setTimeout(() => {
          win.setOpacity(1)
        }, 50)
        win.webContents.removeListener('did-finish-load', onFinishLoad)
      }
      win.webContents.on('did-finish-load', onFinishLoad)

      win.webContents.reload()
    }
  })

  // 创建新窗口
  ipcMain.handle('window:create', async (event, url: string, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const plugin = pluginWindowManager.getPluginByWindow(win)
    if (plugin) {
      const newWin = pluginWindowManager.createAuxiliaryWindow(plugin, url, options)
      return newWin ? newWin.id : null
    }
    return null
  })
}
