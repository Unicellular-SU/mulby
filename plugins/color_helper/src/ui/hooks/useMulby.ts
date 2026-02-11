import { useMemo } from 'react'

export function useMulby(pluginId?: string) {
  return useMemo(() => ({
    // Clipboard API
    clipboard: {
      readText: () => window.mulby?.clipboard?.readText(),
      writeText: (text: string) => window.mulby?.clipboard?.writeText(text),
      readImage: () => window.mulby?.clipboard?.readImage(),
      writeImage: (image: string | ArrayBuffer) => window.mulby?.clipboard?.writeImage(image),
      readFiles: () => window.mulby?.clipboard?.readFiles(),
      writeFiles: (files: string | string[]) => window.mulby?.clipboard?.writeFiles(files),
      getFormat: () => window.mulby?.clipboard?.getFormat(),
    },

    // Input API
    input: {
      hideMainWindowPasteText: (text: string) => window.mulby?.input?.hideMainWindowPasteText(text),
      hideMainWindowPasteImage: (image: string | ArrayBuffer) => window.mulby?.input?.hideMainWindowPasteImage(image),
      hideMainWindowPasteFile: (filePaths: string | string[]) => window.mulby?.input?.hideMainWindowPasteFile(filePaths),
      hideMainWindowTypeString: (text: string) => window.mulby?.input?.hideMainWindowTypeString(text),
      simulateKeyboardTap: (key: string, ...modifiers: string[]) =>
        window.mulby?.input?.simulateKeyboardTap(key, ...modifiers),
      simulateMouseMove: (x: number, y: number) => window.mulby?.input?.simulateMouseMove(x, y),
      simulateMouseClick: (x: number, y: number) => window.mulby?.input?.simulateMouseClick(x, y),
      simulateMouseDoubleClick: (x: number, y: number) => window.mulby?.input?.simulateMouseDoubleClick(x, y),
      simulateMouseRightClick: (x: number, y: number) => window.mulby?.input?.simulateMouseRightClick(x, y),
    },

    // Storage API
    storage: {
      get: (key: string) => window.mulby?.storage?.get(key, pluginId),
      set: (key: string, value: unknown) => window.mulby?.storage?.set(key, value, pluginId),
      remove: (key: string) => window.mulby?.storage?.remove(key, pluginId),
    },

    // Notification API
    notification: {
      show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') =>
        window.mulby?.notification?.show(message, type),
    },

    // Window API
    window: {
      setSize: (width: number, height: number) => window.mulby?.window?.setSize(width, height),
      setExpendHeight: (height: number) => window.mulby?.window?.setExpendHeight?.(height),
      center: () => window.mulby?.window?.center?.(),
      hide: (isRestorePreWindow?: boolean) => window.mulby?.window?.hide?.(isRestorePreWindow),
      show: () => window.mulby?.window?.show(),
      close: () => window.mulby?.window?.close(),
      create: (url: string, options?: { width?: number; height?: number; title?: string }) =>
        window.mulby?.window?.create(url, options),
      detach: () => window.mulby?.window?.detach?.(),
      setAlwaysOnTop: (flag: boolean) => window.mulby?.window?.setAlwaysOnTop?.(flag),
      getMode: () => window.mulby?.window?.getMode?.(),
      getWindowType: () => window.mulby?.window?.getWindowType?.(),
      minimize: () => window.mulby?.window?.minimize?.(),
      maximize: () => window.mulby?.window?.maximize?.(),
      getState: () => window.mulby?.window?.getState?.(),
      reload: () => window.mulby?.window?.reload?.(),
      sendToParent: (channel: string, ...args: unknown[]) =>
        window.mulby?.window?.sendToParent?.(channel, ...args),
      onChildMessage: (callback: (channel: string, ...args: unknown[]) => void) =>
        window.mulby?.window?.onChildMessage?.(callback),
      findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) =>
        window.mulby?.window?.findInPage?.(text, options),
      stopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection') =>
        window.mulby?.window?.stopFindInPage?.(action),
      startDrag: (filePath: string | string[]) => window.mulby?.window?.startDrag?.(filePath),
    },

    // SubInput API
    subInput: {
      set: (placeholder?: string, isFocus?: boolean) => window.mulby?.subInput?.set?.(placeholder, isFocus),
      remove: () => window.mulby?.subInput?.remove?.(),
      setValue: (text: string) => window.mulby?.subInput?.setValue?.(text),
      focus: () => window.mulby?.subInput?.focus?.(),
      blur: () => window.mulby?.subInput?.blur?.(),
      select: () => window.mulby?.subInput?.select?.(),
      onChange: (callback: (data: { text: string }) => void) => window.mulby?.subInput?.onChange?.(callback),
    },

    // Plugin API
    plugin: {
      redirect: (label: string | [string, string], payload?: unknown) =>
        window.mulby?.plugin?.redirect?.(label, payload),
      outPlugin: (isKill?: boolean) => window.mulby?.plugin?.outPlugin?.(isKill),
    },

    // HTTP API
    http: {
      request: (options: {
        url: string
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
        headers?: Record<string, string>
        body?: unknown
        timeout?: number
      }) => window.mulby?.http?.request(options),
      get: (url: string, headers?: Record<string, string>) => window.mulby?.http?.get(url, headers),
      post: (url: string, body?: unknown, headers?: Record<string, string>) =>
        window.mulby?.http?.post(url, body, headers),
      put: (url: string, body?: unknown, headers?: Record<string, string>) =>
        window.mulby?.http?.put(url, body, headers),
      delete: (url: string, headers?: Record<string, string>) => window.mulby?.http?.delete(url, headers),
    },

    // Filesystem API
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') => window.mulby?.filesystem?.readFile(path, encoding),
      writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') =>
        window.mulby?.filesystem?.writeFile(path, data, encoding),
      exists: (path: string) => window.mulby?.filesystem?.exists(path),
      readdir: (path: string) => window.mulby?.filesystem?.readdir(path),
      mkdir: (path: string) => window.mulby?.filesystem?.mkdir(path),
      stat: (path: string) => window.mulby?.filesystem?.stat(path),
      copy: (src: string, dest: string) => window.mulby?.filesystem?.copy(src, dest),
      move: (src: string, dest: string) => window.mulby?.filesystem?.move(src, dest),
      unlink: (path: string) => window.mulby?.filesystem?.unlink(path),
    },

    // Screen API
    screen: {
      getAllDisplays: () => window.mulby?.screen?.getAllDisplays(),
      getPrimaryDisplay: () => window.mulby?.screen?.getPrimaryDisplay(),
      getCursorScreenPoint: () => window.mulby?.screen?.getCursorScreenPoint(),
      getDisplayNearestPoint: (point: { x: number; y: number }) =>
        window.mulby?.screen?.getDisplayNearestPoint?.(point),
      getDisplayMatching: (rect: { x: number; y: number; width: number; height: number }) =>
        window.mulby?.screen?.getDisplayMatching?.(rect),
      getSources: (options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }) =>
        window.mulby?.screen?.getSources(options),
      capture: (options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }) =>
        window.mulby?.screen?.capture(options),
      captureRegion: (region: { x: number; y: number; width: number; height: number }, options?: { format?: 'png' | 'jpeg'; quality?: number }) =>
        window.mulby?.screen?.captureRegion(region, options),
      screenCapture: () => window.mulby?.screen?.screenCapture(),
      colorPick: () => window.mulby?.screen?.colorPick?.(),
    },

    // Shell API
    shell: {
      openPath: (path: string) => window.mulby?.shell?.openPath(path),
      openExternal: (url: string) => window.mulby?.shell?.openExternal(url),
      showItemInFolder: (path: string) => window.mulby?.shell?.showItemInFolder(path),
      openFolder: (path: string) => window.mulby?.shell?.openFolder(path),
      trashItem: (path: string) => window.mulby?.shell?.trashItem(path),
      beep: () => window.mulby?.shell?.beep(),
    },

    // Dialog API
    dialog: {
      showOpenDialog: (options?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
        properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
      }) => window.mulby?.dialog?.showOpenDialog(options),
      showSaveDialog: (options?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
      }) => window.mulby?.dialog?.showSaveDialog(options),
      showMessageBox: (options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title?: string
        message: string
        detail?: string
        buttons?: string[]
      }) => window.mulby?.dialog?.showMessageBox(options),
    },

    // System API
    system: {
      getSystemInfo: () => window.mulby?.system?.getSystemInfo(),
      getAppInfo: () => window.mulby?.system?.getAppInfo(),
      getPath: (name: string) => window.mulby?.system?.getPath(name as any),
      getEnv: (name: string) => window.mulby?.system?.getEnv(name),
      getIdleTime: () => window.mulby?.system?.getIdleTime(),
      getFileIcon: (filePath: string) => window.mulby?.system?.getFileIcon?.(filePath),
      getNativeId: () => window.mulby?.system?.getNativeId?.(),
      isDev: () => window.mulby?.system?.isDev?.(),
      isMacOS: () => window.mulby?.system?.isMacOS?.(),
      isWindows: () => window.mulby?.system?.isWindows?.(),
      isLinux: () => window.mulby?.system?.isLinux?.(),
    },

    // Permission API
    permission: {
      getStatus: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.mulby?.permission?.getStatus(type),
      request: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.mulby?.permission?.request(type),
      canRequest: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.mulby?.permission?.canRequest(type),
      openSystemSettings: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.mulby?.permission?.openSystemSettings(type),
      isAccessibilityTrusted: () => window.mulby?.permission?.isAccessibilityTrusted()
    },

    // Power API
    power: {
      getSystemIdleTime: () => window.mulby?.power?.getSystemIdleTime(),
      getSystemIdleState: (threshold: number) => window.mulby?.power?.getSystemIdleState(threshold),
      isOnBatteryPower: () => window.mulby?.power?.isOnBatteryPower(),
      getCurrentThermalState: () => window.mulby?.power?.getCurrentThermalState(),
    },

    // Network API
    network: {
      isOnline: () => window.mulby?.network?.isOnline(),
    },

    // Geolocation API
    geolocation: {
      getAccessStatus: () => window.mulby?.geolocation?.getAccessStatus(),
      requestAccess: () => window.mulby?.geolocation?.requestAccess(),
      canGetPosition: () => window.mulby?.geolocation?.canGetPosition(),
      openSettings: () => window.mulby?.geolocation?.openSettings(),
      getCurrentPosition: () => window.mulby?.geolocation?.getCurrentPosition(),
    },

    // TTS API
    tts: {
      speak: (text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }) =>
        window.mulby?.tts?.speak(text, options),
      stop: () => window.mulby?.tts?.stop(),
      pause: () => window.mulby?.tts?.pause(),
      resume: () => window.mulby?.tts?.resume(),
      getVoices: () => window.mulby?.tts?.getVoices(),
      isSpeaking: () => window.mulby?.tts?.isSpeaking(),
    },

    // Media API
    media: {
      getAccessStatus: (type: 'camera' | 'microphone') => window.mulby?.media?.getAccessStatus(type),
      askForAccess: (type: 'camera' | 'microphone') => window.mulby?.media?.askForAccess(type),
      hasCameraAccess: () => window.mulby?.media?.hasCameraAccess(),
      hasMicrophoneAccess: () => window.mulby?.media?.hasMicrophoneAccess(),
    },

    // Shortcut API
    shortcut: {
      register: (accelerator: string) => window.mulby?.shortcut?.register(accelerator),
      unregister: (accelerator: string) => window.mulby?.shortcut?.unregister(accelerator),
      unregisterAll: () => window.mulby?.shortcut?.unregisterAll(),
      isRegistered: (accelerator: string) => window.mulby?.shortcut?.isRegistered(accelerator),
    },

    // Security API
    security: {
      isEncryptionAvailable: () => window.mulby?.security?.isEncryptionAvailable(),
      encryptString: (text: string) => window.mulby?.security?.encryptString(text),
      decryptString: (data: ArrayBuffer) => window.mulby?.security?.decryptString(data),
    },

    // Tray API
    tray: {
      create: (options: { icon: string; tooltip?: string; title?: string }) =>
        window.mulby?.tray?.create(options),
      destroy: () => window.mulby?.tray?.destroy(),
      setIcon: (icon: string) => window.mulby?.tray?.setIcon(icon),
      setTooltip: (tooltip: string) => window.mulby?.tray?.setTooltip(tooltip),
      setTitle: (title: string) => window.mulby?.tray?.setTitle(title),
      exists: () => window.mulby?.tray?.exists(),
    },

    // Menu API
    menu: {
      showContextMenu: (items: {
        label?: string
        type?: 'normal' | 'separator' | 'checkbox' | 'radio'
        checked?: boolean
        enabled?: boolean
        id?: string
        submenu?: unknown[]
      }[]) => window.mulby?.menu?.showContextMenu(items as Parameters<typeof window.mulby.menu.showContextMenu>[0]),
    },

    // Theme API
    theme: {
      get: () => window.mulby?.theme?.get(),
      set: (mode: 'light' | 'dark' | 'system') => window.mulby?.theme?.set(mode),
      getActual: () => window.mulby?.theme?.getActual(),
    },

    // Host API
    host: {
      invoke: (pluginName: string, method: string, ...args: unknown[]) => window.mulby?.host?.invoke(pluginName, method, ...args),
      status: (pluginName: string) => window.mulby?.host?.status(pluginName),
      restart: (pluginName: string) => window.mulby?.host?.restart(pluginName),
    },

    // InBrowser API
    inbrowser: window.mulby?.inbrowser,

    // Sharp API
    sharp: window.mulby?.sharp,
    getSharpVersion: () => window.mulby?.getSharpVersion?.(),

    // FFmpeg API
    ffmpeg: window.mulby?.ffmpeg,
  }), [pluginId])
}
