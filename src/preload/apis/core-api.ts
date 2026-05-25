import type { IpcRenderer } from 'electron'

type WindowState = {
  isMaximized: boolean
  canMaximize?: boolean
}

export function createCoreApi(ipcRenderer: IpcRenderer) {
  return {
    window: {
      hide: (isRestorePreWindow?: boolean) => ipcRenderer.send('window:hide', isRestorePreWindow),
      show: () => ipcRenderer.send('window:show'),
      focus: () => ipcRenderer.send('window:requestFocus'),
      showInactive: () => ipcRenderer.send('window:showInactive'),
      setTitle: (title: string) => ipcRenderer.send('window:setTitle', title),
      setSize: (width: number, height: number) =>
        ipcRenderer.send('window:setSize', width, height),
      setPosition: (x: number, y: number) =>
        ipcRenderer.send('window:setPosition', x, y),
      setBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) =>
        ipcRenderer.invoke('window:setBounds', bounds),
      getBounds: () => ipcRenderer.invoke('window:getBounds'),
      setExpendHeight: (height: number, allowResize?: boolean) => ipcRenderer.send('window:setExpendHeight', height, allowResize),
      invalidate: () => ipcRenderer.send('window:invalidate'),
      center: () => ipcRenderer.send('window:center'),
      detach: () => ipcRenderer.send('plugin:detach'),
      close: () => ipcRenderer.send('plugin:close'),
      terminatePlugin: () => ipcRenderer.invoke('plugin:terminateCurrent'),
      showPluginMenu: (point?: { x: number; y: number }) => ipcRenderer.invoke('plugin:showAttachedMenu', point),
      setAlwaysOnTop: (flag: boolean, level?: string) => ipcRenderer.send('window:alwaysOnTop', flag, level),
      setOpacity: (opacity: number) => ipcRenderer.invoke('window:setOpacity', opacity),
      getOpacity: () => ipcRenderer.invoke('window:getOpacity'),
      setBackgroundThrottling: (allowed: boolean) => ipcRenderer.invoke('window:setBackgroundThrottling', allowed),
      setIgnoreMouseEvents: (ignore: boolean, opts?: { forward?: boolean }) =>
        ipcRenderer.send('window:setIgnoreMouseEvents', ignore, opts),
      setVisibleOnAllWorkspaces: (flag: boolean, opts?: { visibleOnFullScreen?: boolean }) =>
        ipcRenderer.send('window:setVisibleOnAllWorkspaces', flag, opts),
      setFullScreen: (flag: boolean) => ipcRenderer.send('window:setFullScreen', flag),
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
        loadMode?: 'route' | 'file';
        preload?: string;
        type?: 'default' | 'borderless' | 'fullscreen';
        titleBar?: boolean;
        fullscreen?: boolean;
        alwaysOnTop?: boolean;
        alwaysOnTopLevel?: string;
        resizable?: boolean;
        movable?: boolean;
        minimizable?: boolean;
        maximizable?: boolean;
        fullscreenable?: boolean;
        focusable?: boolean;
        skipTaskbar?: boolean;
        enableLargerThanScreen?: boolean;
        x?: number; y?: number;
        minWidth?: number; minHeight?: number;
        maxWidth?: number; maxHeight?: number;
        inheritWindowSizeLimits?: boolean;
        opacity?: number;
        transparent?: boolean;
        backgroundThrottling?: boolean;
        visibleOnAllWorkspaces?: boolean;
        visibleOnFullScreen?: boolean;
        ignoreMouseEvents?: boolean;
        forwardMouseEvents?: boolean;
        params?: Record<string, string>;
      }) => {
        const id = await ipcRenderer.invoke('window:create', url, options)
        if (!id) return null
        return {
          id,
          show: () => ipcRenderer.invoke('window:child:action', id, 'show'),
          hide: () => ipcRenderer.invoke('window:child:action', id, 'hide'),
          close: () => ipcRenderer.invoke('window:child:action', id, 'close'),
          destroy: () => ipcRenderer.invoke('window:child:action', id, 'destroy'),
          focus: () => ipcRenderer.invoke('window:child:action', id, 'focus'),
          showInactive: () => ipcRenderer.invoke('window:child:action', id, 'showInactive'),
          setTitle: (title: string) => ipcRenderer.invoke('window:child:action', id, 'setTitle', title),
          setSize: (width: number, height: number) => ipcRenderer.invoke('window:child:action', id, 'setSize', width, height),
          setPosition: (x: number, y: number) => ipcRenderer.invoke('window:child:action', id, 'setPosition', x, y),
          setBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) => ipcRenderer.invoke('window:child:action', id, 'setBounds', bounds),
          getBounds: () => ipcRenderer.invoke('window:child:action', id, 'getBounds'),
          setOpacity: (opacity: number) => ipcRenderer.invoke('window:child:action', id, 'setOpacity', opacity),
          setBackgroundThrottling: (allowed: boolean) => ipcRenderer.invoke('window:child:action', id, 'setBackgroundThrottling', allowed),
          setIgnoreMouseEvents: (ignore: boolean, opts?: { forward?: boolean }) => ipcRenderer.invoke('window:child:action', id, 'setIgnoreMouseEvents', ignore, opts),
          setAlwaysOnTop: (flag: boolean, level?: string) => ipcRenderer.invoke('window:child:action', id, 'setAlwaysOnTop', flag, level),
          setVisibleOnAllWorkspaces: (flag: boolean, opts?: { visibleOnFullScreen?: boolean }) => ipcRenderer.invoke('window:child:action', id, 'setVisibleOnAllWorkspaces', flag, opts),
          setFullScreen: (flag: boolean) => ipcRenderer.invoke('window:child:action', id, 'setFullScreen', flag),
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
      set: (placeholder?: string, isFocus?: boolean, options?: { forwardKeys?: string[] }) =>
        ipcRenderer.invoke('subInput:set', placeholder, isFocus, options),
      remove: () => ipcRenderer.invoke('subInput:remove'),
      setValue: (text: string) => ipcRenderer.send('subInput:setValue', text),
      focus: () => ipcRenderer.send('subInput:focus'),
      blur: () => ipcRenderer.send('subInput:blur'),
      select: () => ipcRenderer.send('subInput:select'),
      onChange: (callback: (data: { text: string }) => void) => {
        const listener = (_event: unknown, data: { text: string }) => callback(data)
        ipcRenderer.on('subInput:onChange', listener)
        return () => ipcRenderer.removeListener('subInput:onChange', listener)
      },
      onKeyDown: (callback: (data: { key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }) => void) => {
        const listener = (_event: unknown, data: { key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }) => callback(data)
        ipcRenderer.on('subInput:onKeyDown', listener)
        return () => ipcRenderer.removeListener('subInput:onKeyDown', listener)
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

    onWindowStateChange: (callback: (state: WindowState) => void) => {
      const listener = (_event: unknown, state: WindowState) => callback(state)
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
      hideMainWindowPasteImage: (image: string | Buffer | ArrayBuffer | Uint8Array) => ipcRenderer.invoke('input:hideMainWindowPasteImage', image),
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
        ipcRenderer.invoke('notification:show', message, type)
    },

    inputMonitor: {
      isAvailable: () => ipcRenderer.invoke('inputMonitor:isAvailable'),
      requireAccessibility: () => ipcRenderer.invoke('inputMonitor:requireAccessibility'),
      start: (options?: { mouse?: boolean; keyboard?: boolean; throttleMs?: number }) =>
        ipcRenderer.invoke('inputMonitor:start', options),
      stop: (sessionId: string) => ipcRenderer.invoke('inputMonitor:stop', sessionId),
      onEvent: (callback: (event: unknown) => void) => {
        const listener = (_event: unknown, inputEvent: unknown) => callback(inputEvent)
        ipcRenderer.on('inputMonitor:event', listener)
        return () => ipcRenderer.removeListener('inputMonitor:event', listener)
      }
    },

    onboarding: {
      getSettings: () => ipcRenderer.invoke('onboarding:getSettings'),
      updateShortcut: (action: string, accelerator: string) =>
        ipcRenderer.invoke('onboarding:updateShortcut', action, accelerator),
      updateTheme: (mode: string) =>
        ipcRenderer.invoke('onboarding:updateTheme', mode),
      updateAiProvider: (provider: {
        id: string
        type?: string
        label?: string
        enabled: boolean
        apiKey?: string
        baseURL?: string
      }) => ipcRenderer.invoke('onboarding:updateAiProvider', provider),
      updateStoreSources: (sources: {
        id: string
        name: string
        url: string
        enabled: boolean
        priority: number
      }[]) => ipcRenderer.invoke('onboarding:updateStoreSources', sources),
      updateSuperPanel: (superPanel: {
        enabled: boolean
        trigger: {
          type: 'mouse_click' | 'mouse_longpress' | 'keyboard' | 'double_tap'
          mouseButton?: 'middle' | 'back' | 'forward' | 'right'
          longPressMs?: number
          accelerator?: string
          modifier?: 'Command' | 'Ctrl' | 'Alt' | 'Shift'
        }
        blockedApps: string[]
        clipboardPollDelayMs: number
        maxItems: number
        instantTranslation: boolean
        translationMaxLength?: number
      }) => ipcRenderer.invoke('onboarding:updateSuperPanel', superPanel),
      complete: () => ipcRenderer.invoke('onboarding:complete'),
      onClose: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('onboarding:close', listener)
        return () => ipcRenderer.removeListener('onboarding:close', listener)
      }
    }
  }
}
