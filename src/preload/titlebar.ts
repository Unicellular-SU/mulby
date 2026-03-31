/**
 * 标题栏专用 preload 脚本
 *
 * 仅暴露标题栏所需的最小 API：
 * - 窗口控制动作 (minimize / maximize / close / toggle-pin / reload)
 * - 窗口状态查询
 * - 主题变化监听
 * - 初始化数据接收
 */
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  /** 发送标题栏动作 */
  action: (name: string) => {
    ipcRenderer.send('titlebar:action', name)
  },

  /** 获取窗口状态 */
  getState: (): Promise<{ isMaximized: boolean; isAlwaysOnTop: boolean }> => {
    return ipcRenderer.invoke('titlebar:getState')
  },

  /** 监听窗口状态变化 */
  onWindowState: (callback: (state: { isMaximized: boolean }) => void) => {
    ipcRenderer.on('titlebar:windowState', (_event, state) => callback(state))
  },

  /** 监听初始化数据 */
  onInit: (callback: (data: { title: string; theme: string }) => void) => {
    ipcRenderer.on('titlebar:init', (_event, data) => callback(data))
  },

  /** 监听主题变化 */
  onThemeChange: (callback: (theme: string) => void) => {
    ipcRenderer.on('titlebar:themeChanged', (_event, theme) => callback(theme))
  }
}

contextBridge.exposeInMainWorld('mulbyTitlebar', api)
