import { useMemo } from 'react'

export function useIntools(pluginId?: string) {
  return useMemo(() => ({
    clipboard: {
      readText: () => window.intools?.clipboard?.readText(),
      writeText: (text: string) => window.intools?.clipboard?.writeText(text),
      readImage: () => window.intools?.clipboard?.readImage(),
      writeImage: (buffer: ArrayBuffer) => window.intools?.clipboard?.writeImage(buffer),
      readFiles: () => window.intools?.clipboard?.readFiles(),
      getFormat: () => window.intools?.clipboard?.getFormat(),
    },
    storage: {
      get: (key: string) => window.intools?.storage?.get(key, pluginId),
      set: (key: string, value: unknown) => window.intools?.storage?.set(key, value, pluginId),
      remove: (key: string) => window.intools?.storage?.remove(key, pluginId),
    },
    notification: {
      show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => 
        window.intools?.notification?.show(message, type),
    },
    window: {
      hide: () => window.intools?.window?.hide(),
      setSize: (width: number, height: number) => window.intools?.window?.setSize(width, height),
      center: () => window.intools?.window?.center(),
    },
    
    // Theme API
    theme: {
      get: () => window.intools?.theme?.get(),
      set: (mode: 'light' | 'dark' | 'system') => window.intools?.theme?.set(mode),
      getActual: () => window.intools?.theme?.getActual(),
    },

    // Screen API
    screen: {
      getAllDisplays: () => window.intools?.screen?.getAllDisplays(),
      getPrimaryDisplay: () => window.intools?.screen?.getPrimaryDisplay(),
      getDisplayNearestPoint: (point: { x: number; y: number }) => window.intools?.screen?.getDisplayNearestPoint(point),
      getCursorScreenPoint: () => window.intools?.screen?.getCursorScreenPoint(),
      getSources: (options?: any) => window.intools?.screen?.getSources(options),
      capture: (options?: any) => window.intools?.screen?.capture(options),
      captureRegion: (region: any, options?: any) => window.intools?.screen?.captureRegion(region, options),
      getMediaStreamConstraints: (options: any) => window.intools?.screen?.getMediaStreamConstraints(options),
    },

    // Shell API
    shell: {
      openPath: (path: string) => window.intools?.shell?.openPath(path),
      openExternal: (url: string) => window.intools?.shell?.openExternal(url),
      showItemInFolder: (path: string) => window.intools?.shell?.showItemInFolder(path),
      openFolder: (path: string) => window.intools?.shell?.openFolder(path),
      trashItem: (path: string) => window.intools?.shell?.trashItem(path),
      beep: () => window.intools?.shell?.beep(),
    },

    // Filesystem API
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') => window.intools?.filesystem?.readFile(path, encoding),
      writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') => window.intools?.filesystem?.writeFile(path, data, encoding),
      exists: (path: string) => window.intools?.filesystem?.exists(path),
      readdir: (path: string) => window.intools?.filesystem?.readdir(path),
      mkdir: (path: string) => window.intools?.filesystem?.mkdir(path),
      stat: (path: string) => window.intools?.filesystem?.stat(path),
      copy: (src: string, dest: string) => window.intools?.filesystem?.copy(src, dest),
      move: (src: string, dest: string) => window.intools?.filesystem?.move(src, dest),
      unlink: (path: string) => window.intools?.filesystem?.unlink(path),
    },

    // Dialog API
    dialog: {
      showOpenDialog: (options?: any) => window.intools?.dialog?.showOpenDialog(options),
      showSaveDialog: (options?: any) => window.intools?.dialog?.showSaveDialog(options),
      showMessageBox: (options: any) => window.intools?.dialog?.showMessageBox(options),
      showErrorBox: (title: string, content: string) => window.intools?.dialog?.showErrorBox(title, content),
    },

    // System API
    system: {
      getSystemInfo: () => window.intools?.system?.getSystemInfo(),
      getAppInfo: () => window.intools?.system?.getAppInfo(),
      getPath: (name: string) => window.intools?.system?.getPath(name as any),
      getEnv: (name: string) => window.intools?.system?.getEnv(name),
      getIdleTime: () => window.intools?.system?.getIdleTime(),
    },

    // Shortcut API
    shortcut: {
      register: (accelerator: string) => window.intools?.shortcut?.register(accelerator),
      unregister: (accelerator: string) => window.intools?.shortcut?.unregister(accelerator),
      unregisterAll: () => window.intools?.shortcut?.unregisterAll(),
      isRegistered: (accelerator: string) => window.intools?.shortcut?.isRegistered(accelerator),
      onTriggered: (callback: (accelerator: string) => void) => window.intools?.shortcut?.onTriggered(callback),
    },

    // Security API
    security: {
      isEncryptionAvailable: () => window.intools?.security?.isEncryptionAvailable(),
      encryptString: (plainText: string) => window.intools?.security?.encryptString(plainText),
      decryptString: (encrypted: ArrayBuffer) => window.intools?.security?.decryptString(encrypted),
    },

    // Media API
    media: {
      getAccessStatus: (mediaType: 'microphone' | 'camera') => window.intools?.media?.getAccessStatus(mediaType),
      askForAccess: (mediaType: 'microphone' | 'camera') => window.intools?.media?.askForAccess(mediaType),
      hasCameraAccess: () => window.intools?.media?.hasCameraAccess(),
      hasMicrophoneAccess: () => window.intools?.media?.hasMicrophoneAccess(),
    },

    // Power API
    power: {
      getSystemIdleTime: () => window.intools?.power?.getSystemIdleTime(),
      getSystemIdleState: (idleThreshold: number) => window.intools?.power?.getSystemIdleState(idleThreshold),
      isOnBatteryPower: () => window.intools?.power?.isOnBatteryPower(),
      getCurrentThermalState: () => window.intools?.power?.getCurrentThermalState(),
      onSuspend: (callback: () => void) => window.intools?.power?.onSuspend(callback),
      onResume: (callback: () => void) => window.intools?.power?.onResume(callback),
      onAC: (callback: () => void) => window.intools?.power?.onAC(callback),
      onBattery: (callback: () => void) => window.intools?.power?.onBattery(callback),
      onLockScreen: (callback: () => void) => window.intools?.power?.onLockScreen(callback),
      onUnlockScreen: (callback: () => void) => window.intools?.power?.onUnlockScreen(callback),
    },

    // Tray API
    tray: {
      create: (options: any) => window.intools?.tray?.create(options),
      destroy: () => window.intools?.tray?.destroy(),
      setIcon: (icon: string) => window.intools?.tray?.setIcon(icon),
      setTooltip: (tooltip: string) => window.intools?.tray?.setTooltip(tooltip),
      setTitle: (title: string) => window.intools?.tray?.setTitle(title),
      exists: () => window.intools?.tray?.exists(),
    },

    // HTTP API
    http: {
      request: (options: any) => window.intools?.http?.request(options),
      get: (url: string, headers?: Record<string, string>) => window.intools?.http?.get(url, headers),
      post: (url: string, body?: any, headers?: Record<string, string>) => window.intools?.http?.post(url, body, headers),
      put: (url: string, body?: any, headers?: Record<string, string>) => window.intools?.http?.put(url, body, headers),
      delete: (url: string, headers?: Record<string, string>) => window.intools?.http?.delete(url, headers),
    },

    // Network API
    network: {
      isOnline: () => window.intools?.network?.isOnline(),
      onOnline: (callback: () => void) => window.intools?.network?.onOnline(callback),
      onOffline: (callback: () => void) => window.intools?.network?.onOffline(callback),
    },

    // Menu API
    menu: {
      showContextMenu: (items: any[]) => window.intools?.menu?.showContextMenu(items),
    },

    // Geolocation API
    geolocation: {
      getAccessStatus: () => window.intools?.geolocation?.getAccessStatus(),
      requestAccess: () => window.intools?.geolocation?.requestAccess(),
      canGetPosition: () => window.intools?.geolocation?.canGetPosition(),
      openSettings: () => window.intools?.geolocation?.openSettings(),
      getCurrentPosition: () => window.intools?.geolocation?.getCurrentPosition(),
    },

    // TTS API
    tts: {
      speak: (text: string, options?: any) => window.intools?.tts?.speak(text, options),
      stop: () => window.intools?.tts?.stop(),
      pause: () => window.intools?.tts?.pause(),
      resume: () => window.intools?.tts?.resume(),
      getVoices: () => window.intools?.tts?.getVoices(),
      isSpeaking: () => window.intools?.tts?.isSpeaking(),
    },

    // Host API
    host: {
      invoke: (pluginName: string, method: string, ...args: any[]) => window.intools?.host?.invoke(pluginName, method, ...args),
      status: (pluginName: string) => window.intools?.host?.status(pluginName),
      restart: (pluginName: string) => window.intools?.host?.restart(pluginName),
    },
  }), [pluginId])
}
