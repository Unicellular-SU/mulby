/**
 * 标题栏专用 preload 脚本
 *
 * 仅暴露标题栏所需的最小 API：
 * - 窗口控制动作 (minimize / maximize / close / toggle-pin / reload)
 * - 插件操作菜单
 * - 窗口状态查询
 * - 主题变化监听
 * - 初始化数据接收
 * - 窗口拖拽 (JS fallback for -webkit-app-region issues in multi-view)
 */
import { contextBridge, ipcRenderer } from 'electron'

type TitlebarWindowState = {
  isMaximized: boolean
  isAlwaysOnTop?: boolean
  canMaximize: boolean
}

const api = {
  /** 发送标题栏动作 */
  action: (name: string) => {
    ipcRenderer.send('titlebar:action', name)
  },

  /** 显示插件更多操作菜单 */
  showPluginMenu: (point?: { x: number; y: number }): Promise<boolean> => {
    return ipcRenderer.invoke('titlebar:showPluginMenu', point)
  },

  /** 获取窗口状态 */
  getState: (): Promise<TitlebarWindowState & { isAlwaysOnTop: boolean }> => {
    return ipcRenderer.invoke('titlebar:getState')
  },

  /** 开始拖拽窗口 */
  startDrag: (screenX: number, screenY: number) => {
    ipcRenderer.send('titlebar:startDrag', screenX, screenY)
  },

  /** 拖拽中移动窗口 */
  dragging: (screenX: number, screenY: number) => {
    ipcRenderer.send('titlebar:dragging', screenX, screenY)
  },

  /** 结束拖拽 */
  endDrag: () => {
    ipcRenderer.send('titlebar:endDrag')
  },

  /** 请求窗口获取焦点 */
  requestFocus: () => {
    ipcRenderer.send('titlebar:requestFocus')
  },

  /** 监听窗口状态变化 */
  onWindowState: (callback: (state: TitlebarWindowState) => void) => {
    ipcRenderer.on('titlebar:windowState', (_event, state) => callback(state))
  },

  /** 监听初始化数据 */
  onInit: (callback: (data: { title: string; theme: string; isDev?: boolean }) => void) => {
    ipcRenderer.on('titlebar:init', (_event, data) => callback(data))
  },

  /** 监听标题变化 */
  onTitleChange: (callback: (title: string) => void) => {
    ipcRenderer.on('titlebar:titleChanged', (_event, title) => callback(title))
  },

  /** 监听主题变化 */
  onThemeChange: (callback: (theme: string) => void) => {
    ipcRenderer.on('titlebar:themeChanged', (_event, theme) => callback(theme))
  }
}

contextBridge.exposeInMainWorld('mulbyTitlebar', api)
