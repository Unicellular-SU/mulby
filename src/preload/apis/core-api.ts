import type { IpcRenderer } from 'electron'

export function createCoreApi(ipcRenderer: IpcRenderer) {
  return {
    window: {
      hide: (isRestorePreWindow?: boolean) => ipcRenderer.send('window:hide', isRestorePreWindow),
      show: () => ipcRenderer.send('window:show'),
      setSize: (width: number, height: number) =>
        ipcRenderer.send('window:setSize', width, height),
      setExpendHeight: (height: number, allowResize?: boolean) => ipcRenderer.send('window:setExpendHeight', height, allowResize),
      center: () => ipcRenderer.send('window:center'),
      detach: () => ipcRenderer.send('plugin:detach'),
      close: () => ipcRenderer.send('plugin:close'),
      setAlwaysOnTop: (flag: boolean) => ipcRenderer.send('window:alwaysOnTop', flag),
      setOpacity: (opacity: number) => ipcRenderer.invoke('window:setOpacity', opacity),
      getOpacity: () => ipcRenderer.invoke('window:getOpacity'),
      getMode: () => ipcRenderer.invoke('plugin:getMode'),
      getWindowType: () => ipcRenderer.invoke('window:getType'),
      minimize: () => ipcRenderer.send('window:minimize'),
      maximize: () => ipcRenderer.send('window:maximize'),
      getState: () => ipcRenderer.invoke('window:getState'),
      resizeDrag: (payload: {
        edge: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
        startX: number
        startY: number
        currentX: number
        currentY: number
        baseBounds: { x: number; y: number; width: number; height: number }
      }) => ipcRenderer.send('window:resizeDrag', payload),
      reload: () => ipcRenderer.send('plugin:reload'),
      create: async (url: string, options?: {
        width?: number; height?: number; title?: string;
        type?: 'default' | 'borderless' | 'fullscreen';
        titleBar?: boolean;
        fullscreen?: boolean;
        alwaysOnTop?: boolean;
        resizable?: boolean;
        x?: number; y?: number;
        minWidth?: number; minHeight?: number;
        maxWidth?: number; maxHeight?: number;
        opacity?: number;
        transparent?: boolean;
      }) => {
        const id = await ipcRenderer.invoke('window:create', url, options)
        if (!id) return null
        return {
          id,
          show: () => ipcRenderer.invoke('window:child:action', id, 'show'),
          hide: () => ipcRenderer.invoke('window:child:action', id, 'hide'),
          close: () => ipcRenderer.invoke('window:child:action', id, 'close'),
          focus: () => ipcRenderer.invoke('window:child:action', id, 'focus'),
          setTitle: (title: string) => ipcRenderer.invoke('window:child:action', id, 'setTitle', title),
          setSize: (width: number, height: number) => ipcRenderer.invoke('window:child:action', id, 'setSize', width, height),
          setPosition: (x: number, y: number) => ipcRenderer.invoke('window:child:action', id, 'setPosition', x, y),
          setOpacity: (opacity: number) => ipcRenderer.invoke('window:child:action', id, 'setOpacity', opacity),
          postMessage: (channel: string, ...args: unknown[]) => ipcRenderer.invoke('window:child:action', id, 'postMessage', channel, ...args)
        }
      },
      sendToParent: (channel: string, ...args: unknown[]) =>
        ipcRenderer.send('window:sendToParent', channel, ...args),
      onChildMessage: (callback: (channel: string, ...args: unknown[]) => void) => {
        const listener = (_event: unknown, channel: string, ...args: unknown[]) => callback(channel, ...args)
        ipcRenderer.on('window:childMessage', listener)
        return () => ipcRenderer.removeListener('window:childMessage', listener)
      },
      findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) =>
        ipcRenderer.invoke('webContents:findInPage', text, options),
      stopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection') =>
        ipcRenderer.send('webContents:stopFindInPage', action),
      startDrag: (filePath: string | string[]) => ipcRenderer.send('window:startDrag', filePath)
    },

    subInput: {
      set: (placeholder?: string, isFocus?: boolean) =>
        ipcRenderer.invoke('subInput:set', placeholder, isFocus),
      remove: () => ipcRenderer.invoke('subInput:remove'),
      setValue: (text: string) => ipcRenderer.send('subInput:setValue', text),
      focus: () => ipcRenderer.send('subInput:focus'),
      blur: () => ipcRenderer.send('subInput:blur'),
      select: () => ipcRenderer.send('subInput:select'),
      onChange: (callback: (data: { text: string }) => void) => {
        const listener = (_event: unknown, data: { text: string }) => callback(data)
        ipcRenderer.on('subInput:onChange', listener)
        return () => ipcRenderer.removeListener('subInput:onChange', listener)
      }
    },

    theme: {
      get: () => ipcRenderer.invoke('theme:get'),
      set: (mode: 'light' | 'dark' | 'system') => ipcRenderer.invoke('theme:set', mode),
      getActual: () => ipcRenderer.invoke('theme:getActual')
    },

    onThemeChange: (callback: (theme: 'light' | 'dark') => void) => {
      const listener = (_event: unknown, theme: 'light' | 'dark') => callback(theme)
      ipcRenderer.on('theme:changed', listener)
      return () => ipcRenderer.removeListener('theme:changed', listener)
    },

    onWindowStateChange: (callback: (state: { isMaximized: boolean }) => void) => {
      const listener = (_event: unknown, state: { isMaximized: boolean }) => callback(state)
      ipcRenderer.on('window:stateChanged', listener)
      return () => ipcRenderer.removeListener('window:stateChanged', listener)
    },

    clipboard: {
      readText: () => ipcRenderer.invoke('clipboard:readText'),
      writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
      readImage: () => ipcRenderer.invoke('clipboard:readImage'),
      writeImage: (image: string | Buffer | ArrayBuffer | Uint8Array) =>
        ipcRenderer.invoke('clipboard:writeImage', image),
      readFiles: () => ipcRenderer.invoke('clipboard:readFiles'),
      writeFiles: (files: string | string[]) => ipcRenderer.invoke('clipboard:writeFiles', files),
      getFormat: () => ipcRenderer.invoke('clipboard:getFormat')
    },

    input: {
      hideMainWindowPasteText: (text: string) => ipcRenderer.invoke('input:hideMainWindowPasteText', text),
      hideMainWindowPasteImage: (image: string | Buffer) => ipcRenderer.invoke('input:hideMainWindowPasteImage', image),
      hideMainWindowPasteFile: (filePaths: string | string[]) => ipcRenderer.invoke('input:hideMainWindowPasteFile', filePaths),
      hideMainWindowTypeString: (text: string) => ipcRenderer.invoke('input:hideMainWindowTypeString', text),
      restoreWindows: () => ipcRenderer.invoke('input:restoreWindows'),
      simulateKeyboardTap: (key: string, ...modifiers: string[]) =>
        ipcRenderer.invoke('input:simulateKeyboardTap', key, modifiers),
      simulateMouseMove: (x: number, y: number) =>
        ipcRenderer.invoke('input:simulateMouseMove', x, y),
      simulateMouseClick: (x: number, y: number) =>
        ipcRenderer.invoke('input:simulateMouseClick', x, y),
      simulateMouseDoubleClick: (x: number, y: number) =>
        ipcRenderer.invoke('input:simulateMouseDoubleClick', x, y),
      simulateMouseRightClick: (x: number, y: number) =>
        ipcRenderer.invoke('input:simulateMouseRightClick', x, y)
    },

    notification: {
      show: (message: string, type?: string) =>
        ipcRenderer.send('notification:show', message, type)
    }
  }
}
