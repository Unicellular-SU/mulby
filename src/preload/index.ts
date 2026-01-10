import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('intools', {
  // 窗口控制
  window: {
    hide: () => ipcRenderer.send('window:hide'),
    setSize: (width: number, height: number) =>
      ipcRenderer.send('window:setSize', width, height),
    center: () => ipcRenderer.send('window:center'),
    // 插件窗口控制
    detach: () => ipcRenderer.send('plugin:detach'),
    close: () => ipcRenderer.send('plugin:close'),
    setAlwaysOnTop: (flag: boolean) => ipcRenderer.send('window:alwaysOnTop', flag),
    getMode: () => ipcRenderer.invoke('plugin:getMode')
  },

  // 主题
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (mode: 'light' | 'dark' | 'system') => ipcRenderer.invoke('theme:set', mode),
    getActual: () => ipcRenderer.invoke('theme:getActual')
  },

  // 主题变化事件
  onThemeChange: (callback: (theme: 'light' | 'dark') => void) => {
    ipcRenderer.on('theme:changed', (_, theme) => callback(theme))
  },

  // 剪贴板
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
    writeImage: (buffer: Buffer) => ipcRenderer.invoke('clipboard:writeImage', buffer),
    readFiles: () => ipcRenderer.invoke('clipboard:readFiles'),
    getFormat: () => ipcRenderer.invoke('clipboard:getFormat')
  },

  // 通知
  notification: {
    show: (message: string, type?: string) =>
      ipcRenderer.send('notification:show', message, type)
  },

  // 插件
  plugin: {
    getAll: () => ipcRenderer.invoke('plugin:getAll'),
    search: (query: string) => ipcRenderer.invoke('plugin:search', query),
    run: (name: string, featureCode: string, input?: string) =>
      ipcRenderer.invoke('plugin:run', name, featureCode, input),
    install: (filePath: string) => ipcRenderer.invoke('plugin:install', filePath),
    enable: (name: string) => ipcRenderer.invoke('plugin:enable', name),
    disable: (name: string) => ipcRenderer.invoke('plugin:disable', name),
    uninstall: (name: string) => ipcRenderer.invoke('plugin:uninstall', name)
  },

  // 插件窗口事件
  onPluginInit: (callback: (data: { pluginName: string; featureCode: string; input: string; mode?: string }) => void) => {
    ipcRenderer.on('plugin:init', (_, data) => callback(data))
  },

  // 插件附着事件（主窗口使用）
  onPluginAttach: (callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string; preloadPath: string }) => void) => {
    ipcRenderer.on('plugin:attach', (_, data) => callback(data))
  },

  // 插件分离事件（主窗口使用）
  onPluginDetached: (callback: () => void) => {
    ipcRenderer.on('plugin:detached', () => callback())
  }
})
