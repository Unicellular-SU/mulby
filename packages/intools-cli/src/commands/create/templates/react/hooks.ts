/**
 * React 插件模板 - Hooks 代码生成器
 * 包含：useIntools.ts
 */

/**
 * 生成 useIntools.ts Hook 内容
 */
export function buildUseIntools() {
  return `import { useMemo } from 'react'

export function useIntools(pluginId?: string) {
  return useMemo(() => ({
    // Clipboard API
    clipboard: {
      readText: () => window.intools?.clipboard?.readText(),
      writeText: (text: string) => window.intools?.clipboard?.writeText(text),
      readImage: () => window.intools?.clipboard?.readImage(),
      writeImage: (image: string | ArrayBuffer) => window.intools?.clipboard?.writeImage(image),
      readFiles: () => window.intools?.clipboard?.readFiles(),
      writeFiles: (files: string | string[]) => window.intools?.clipboard?.writeFiles(files),
      getFormat: () => window.intools?.clipboard?.getFormat(),
    },

    // Clipboard History API
    clipboardHistory: {
      query: (options?: {
        type?: 'text' | 'image' | 'files'
        search?: string
        favorite?: boolean
        limit?: number
        offset?: number
      }) => window.intools?.clipboardHistory?.query(options),
      get: (id: string) => window.intools?.clipboardHistory?.get(id),
      copy: (id: string) => window.intools?.clipboardHistory?.copy(id),
      toggleFavorite: (id: string) => window.intools?.clipboardHistory?.toggleFavorite(id),
      delete: (id: string) => window.intools?.clipboardHistory?.delete(id),
      clear: () => window.intools?.clipboardHistory?.clear(),
      stats: () => window.intools?.clipboardHistory?.stats(),
    },

    // Input API
    input: {
      hideMainWindowPasteText: (text: string) => window.intools?.input?.hideMainWindowPasteText(text),
      hideMainWindowPasteImage: (image: string | ArrayBuffer) => window.intools?.input?.hideMainWindowPasteImage(image),
      hideMainWindowPasteFile: (filePaths: string | string[]) => window.intools?.input?.hideMainWindowPasteFile(filePaths),
      hideMainWindowTypeString: (text: string) => window.intools?.input?.hideMainWindowTypeString(text),
      restoreWindows: () => window.intools?.input?.restoreWindows(),
      simulateKeyboardTap: (key: string, ...modifiers: string[]) =>
        window.intools?.input?.simulateKeyboardTap(key, ...modifiers),
      simulateMouseMove: (x: number, y: number) => window.intools?.input?.simulateMouseMove(x, y),
      simulateMouseClick: (x: number, y: number) => window.intools?.input?.simulateMouseClick(x, y),
      simulateMouseDoubleClick: (x: number, y: number) => window.intools?.input?.simulateMouseDoubleClick(x, y),
      simulateMouseRightClick: (x: number, y: number) => window.intools?.input?.simulateMouseRightClick(x, y),
    },

    // Storage API
    storage: {
      get: (key: string) => window.intools?.storage?.get(key, pluginId),
      set: (key: string, value: unknown) => window.intools?.storage?.set(key, value, pluginId),
      remove: (key: string) => window.intools?.storage?.remove(key, pluginId),
    },

    // AI API
    ai: {
      // option 参数支持：
      // - model: 模型 ID
      // - messages: 消息数组
      // - tools: 工具定义数组
      // - capabilities/internalTools/toolingPolicy: 内置工具能力控制
      // - mcp: MCP 选择策略（off/manual/auto + server/tool 限制）
      // - skills: 技能选择策略
      // - params: 模型参数
      // - toolContext: 工具上下文（插件名与 MCP 作用域）
      // - maxToolSteps: 工具调用的最大步骤数（默认 20，最大 100）
      call: (option: any, onChunk?: (chunk: any) => void) => window.intools?.ai?.call(option, onChunk),
      allModels: () => window.intools?.ai?.allModels?.(),
      abort: (requestId: string) => window.intools?.ai?.abort?.(requestId),
      skills: {
        list: () => window.intools?.ai?.skills?.list?.(),
        refresh: () => window.intools?.ai?.skills?.refresh?.(),
        listEnabled: () => window.intools?.ai?.skills?.listEnabled?.(),
        get: (skillId: string) => window.intools?.ai?.skills?.get?.(skillId),
        listCreateModels: () => window.intools?.ai?.skills?.listCreateModels?.(),
        createWithAi: (input: any) => window.intools?.ai?.skills?.createWithAi?.(input),
        createWithAiStream: (input: any, onChunk: (chunk: any) => void) =>
          window.intools?.ai?.skills?.createWithAiStream?.(input, onChunk),
        create: (input: any) => window.intools?.ai?.skills?.create?.(input),
        install: (input: any) => window.intools?.ai?.skills?.install?.(input),
        importFromJson: (input: any) => window.intools?.ai?.skills?.importFromJson?.(input),
        update: (skillId: string, patch: any) => window.intools?.ai?.skills?.update?.(skillId, patch),
        remove: (skillId: string) => window.intools?.ai?.skills?.remove?.(skillId),
        enable: (skillId: string) => window.intools?.ai?.skills?.enable?.(skillId),
        disable: (skillId: string) => window.intools?.ai?.skills?.disable?.(skillId),
        preview: (input: any) => window.intools?.ai?.skills?.preview?.(input),
        resolve: (option: any) => window.intools?.ai?.skills?.resolve?.(option),
      },
      tokens: {
        estimate: (input: any) => window.intools?.ai?.tokens?.estimate(input),
      },
      attachments: {
        upload: (input: any) => window.intools?.ai?.attachments?.upload(input),
        get: (attachmentId: string) => window.intools?.ai?.attachments?.get(attachmentId),
        delete: (attachmentId: string) => window.intools?.ai?.attachments?.delete(attachmentId),
        uploadToProvider: (input: any) => window.intools?.ai?.attachments?.uploadToProvider(input),
      },
      images: {
        generate: (input: any) => window.intools?.ai?.images?.generate(input),
        generateStream: (input: any, onChunk: (chunk: any) => void) =>
          window.intools?.ai?.images?.generateStream(input, onChunk),
        edit: (input: any) => window.intools?.ai?.images?.edit(input),
      },
      models: {
        fetch: (input: any) => window.intools?.ai?.models?.fetch(input),
      },
      testConnection: (input?: any) => window.intools?.ai?.testConnection?.(input),
      testConnectionStream: (input: any, onChunk: (chunk: any) => void) =>
        window.intools?.ai?.testConnectionStream?.(input, onChunk),
      settings: {
        get: () => window.intools?.ai?.settings?.get(),
        update: (next: any) => window.intools?.ai?.settings?.update(next),
      },
      mcp: {
        listServers: () => window.intools?.ai?.mcp?.listServers?.(),
        getServer: (serverId: string) => window.intools?.ai?.mcp?.getServer?.(serverId),
        upsertServer: (server: any) => window.intools?.ai?.mcp?.upsertServer?.(server),
        removeServer: (serverId: string) => window.intools?.ai?.mcp?.removeServer?.(serverId),
        activateServer: (serverId: string) => window.intools?.ai?.mcp?.activateServer?.(serverId),
        deactivateServer: (serverId: string) => window.intools?.ai?.mcp?.deactivateServer?.(serverId),
        restartServer: (serverId: string) => window.intools?.ai?.mcp?.restartServer?.(serverId),
        checkServer: (serverId: string) => window.intools?.ai?.mcp?.checkServer?.(serverId),
        listTools: (serverId: string) => window.intools?.ai?.mcp?.listTools?.(serverId),
        abort: (callId: string) => window.intools?.ai?.mcp?.abort?.(callId),
        getLogs: (serverId: string) => window.intools?.ai?.mcp?.getLogs?.(serverId),
      },
    },

    // Messaging API
    messaging: {
      send: (targetPluginId: string, type: string, payload: unknown) =>
        window.intools?.messaging?.send(targetPluginId, type, payload),
      broadcast: (type: string, payload: unknown) =>
        window.intools?.messaging?.broadcast(type, payload),
      on: (callback: (message: {
        id: string
        from: string
        to?: string
        type: string
        payload: unknown
        timestamp: number
      }) => void | Promise<void>) => window.intools?.messaging?.on(callback),
      off: (callback?: (message: any) => void) => window.intools?.messaging?.off(callback),
    },

    // Scheduler API
    scheduler: {
      schedule: (task: {
        name: string
        type: 'once' | 'repeat' | 'delay'
        callback: string
        time?: number
        cron?: string
        delay?: number
        payload?: any
        maxRetries?: number
        retryDelay?: number
        timeout?: number
      }) => window.intools?.scheduler?.schedule(task),
      cancelTask: (taskId: string) => window.intools?.scheduler?.cancelTask(taskId),
      pauseTask: (taskId: string) => window.intools?.scheduler?.pauseTask(taskId),
      resumeTask: (taskId: string) => window.intools?.scheduler?.resumeTask(taskId),
      listTasks: (filter?: { status?: string; type?: string; limit?: number; offset?: number }) => window.intools?.scheduler?.listTasks(filter),
      getTaskCount: (filter?: { status?: string; type?: string }) => window.intools?.scheduler?.getTaskCount(filter),
      getTask: (taskId: string) => window.intools?.scheduler?.getTask(taskId),
      deleteTasks: (taskIds: string[]) => window.intools?.scheduler?.deleteTasks(taskIds),
      cleanupTasks: (olderThan?: number) => window.intools?.scheduler?.cleanupTasks(olderThan),
      getExecutions: (taskId: string, limit?: number) => window.intools?.scheduler?.getExecutions(taskId, limit),
      validateCron: (expression: string) => window.intools?.scheduler?.validateCron(expression),
      getNextCronTime: (expression: string, after?: Date) => window.intools?.scheduler?.getNextCronTime(expression, after),
      describeCron: (expression: string) => window.intools?.scheduler?.describeCron(expression),
    },

    // Notification API
    notification: {
      show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') =>
        window.intools?.notification?.show(message, type),
    },

    // Window API
    window: {
      setSize: (width: number, height: number) => window.intools?.window?.setSize(width, height),
      setExpendHeight: (height: number) => window.intools?.window?.setExpendHeight?.(height),
      center: () => window.intools?.window?.center?.(),
      hide: (isRestorePreWindow?: boolean) => window.intools?.window?.hide?.(isRestorePreWindow),
      show: () => window.intools?.window?.show(),
      close: () => window.intools?.window?.close(),
      create: (url: string, options?: { width?: number; height?: number; title?: string }) =>
        window.intools?.window?.create(url, options),
      detach: () => window.intools?.window?.detach?.(),
      setAlwaysOnTop: (flag: boolean) => window.intools?.window?.setAlwaysOnTop?.(flag),
      getMode: () => window.intools?.window?.getMode?.(),
      getWindowType: () => window.intools?.window?.getWindowType?.(),
      minimize: () => window.intools?.window?.minimize?.(),
      maximize: () => window.intools?.window?.maximize?.(),
      getState: () => window.intools?.window?.getState?.(),
      reload: () => window.intools?.window?.reload?.(),
      sendToParent: (channel: string, ...args: unknown[]) =>
        window.intools?.window?.sendToParent?.(channel, ...args),
      onChildMessage: (callback: (channel: string, ...args: unknown[]) => void) =>
        window.intools?.window?.onChildMessage?.(callback),
      findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) =>
        window.intools?.window?.findInPage?.(text, options),
      stopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection') =>
        window.intools?.window?.stopFindInPage?.(action),
      startDrag: (filePath: string | string[]) => window.intools?.window?.startDrag?.(filePath),
    },

    // SubInput API
    subInput: {
      set: (placeholder?: string, isFocus?: boolean) => window.intools?.subInput?.set?.(placeholder, isFocus),
      remove: () => window.intools?.subInput?.remove?.(),
      setValue: (text: string) => window.intools?.subInput?.setValue?.(text),
      focus: () => window.intools?.subInput?.focus?.(),
      blur: () => window.intools?.subInput?.blur?.(),
      select: () => window.intools?.subInput?.select?.(),
      onChange: (callback: (data: { text: string }) => void) => window.intools?.subInput?.onChange?.(callback),
    },

    // Plugin API
    plugin: {
      getAll: () => window.intools?.plugin?.getAll?.(),
      search: (query: string) => window.intools?.plugin?.search?.(query),
      run: (name: string, featureCode: string, input?: string) => window.intools?.plugin?.run?.(name, featureCode, input),
      install: (filePath: string) => window.intools?.plugin?.install?.(filePath),
      uninstall: (name: string) => window.intools?.plugin?.uninstall?.(name),
      getReadme: (name: string) => window.intools?.plugin?.getReadme?.(name),
      redirect: (label: string | [string, string], payload?: unknown) =>
        window.intools?.plugin?.redirect?.(label, payload),
      outPlugin: (isKill?: boolean) => window.intools?.plugin?.outPlugin?.(isKill),
      enable: (name: string) => window.intools?.plugin?.enable?.(name),
      disable: (name: string) => window.intools?.plugin?.disable?.(name),
      listBackground: () => window.intools?.plugin?.listBackground?.(),
      startBackground: (pluginId: string) => window.intools?.plugin?.startBackground?.(pluginId),
      stopBackground: (pluginId: string) => window.intools?.plugin?.stopBackground?.(pluginId),
      getBackgroundInfo: (pluginId: string) => window.intools?.plugin?.getBackgroundInfo?.(pluginId),
      stopPlugin: (pluginId: string) => window.intools?.plugin?.stopPlugin?.(pluginId),
    },

    // HTTP API
    http: {
      request: (options: {
        url: string
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
        headers?: Record<string, string>
        body?: unknown
        timeout?: number
      }) => window.intools?.http?.request(options),
      get: (url: string, headers?: Record<string, string>) => window.intools?.http?.get(url, headers),
      post: (url: string, body?: unknown, headers?: Record<string, string>) =>
        window.intools?.http?.post(url, body, headers),
      put: (url: string, body?: unknown, headers?: Record<string, string>) =>
        window.intools?.http?.put(url, body, headers),
      delete: (url: string, headers?: Record<string, string>) => window.intools?.http?.delete(url, headers),
    },

    // Filesystem API
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') => window.intools?.filesystem?.readFile(path, encoding),
      writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') =>
        window.intools?.filesystem?.writeFile(path, data, encoding),
      exists: (path: string) => window.intools?.filesystem?.exists(path),
      readdir: (path: string) => window.intools?.filesystem?.readdir(path),
      mkdir: (path: string) => window.intools?.filesystem?.mkdir(path),
      stat: (path: string) => window.intools?.filesystem?.stat(path),
      copy: (src: string, dest: string) => window.intools?.filesystem?.copy(src, dest),
      move: (src: string, dest: string) => window.intools?.filesystem?.move(src, dest),
      unlink: (path: string) => window.intools?.filesystem?.unlink(path),
    },

    // Screen API
    screen: {
      getAllDisplays: () => window.intools?.screen?.getAllDisplays(),
      getPrimaryDisplay: () => window.intools?.screen?.getPrimaryDisplay(),
      getCursorScreenPoint: () => window.intools?.screen?.getCursorScreenPoint(),
      getDisplayNearestPoint: (point: { x: number; y: number }) =>
        window.intools?.screen?.getDisplayNearestPoint?.(point),
      getDisplayMatching: (rect: { x: number; y: number; width: number; height: number }) =>
        window.intools?.screen?.getDisplayMatching?.(rect),
      getSources: (options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }) =>
        window.intools?.screen?.getSources(options),
      capture: (options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }) =>
        window.intools?.screen?.capture(options),
      captureRegion: (region: { x: number; y: number; width: number; height: number }, options?: { format?: 'png' | 'jpeg'; quality?: number }) =>
        window.intools?.screen?.captureRegion(region, options),
      screenCapture: () => window.intools?.screen?.screenCapture(),
      colorPick: () => window.intools?.screen?.colorPick?.(),
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

    // Dialog API
    dialog: {
      showOpenDialog: (options?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
        properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
      }) => window.intools?.dialog?.showOpenDialog(options),
      showSaveDialog: (options?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
      }) => window.intools?.dialog?.showSaveDialog(options),
      showMessageBox: (options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title?: string
        message: string
        detail?: string
        buttons?: string[]
      }) => window.intools?.dialog?.showMessageBox(options),
    },

    // System API
    system: {
      getSystemInfo: () => window.intools?.system?.getSystemInfo(),
      getAppInfo: () => window.intools?.system?.getAppInfo(),
      getPath: (name: string) => window.intools?.system?.getPath(name as any),
      getEnv: (name: string) => window.intools?.system?.getEnv(name),
      getIdleTime: () => window.intools?.system?.getIdleTime(),
      getFileIcon: (filePath: string) => window.intools?.system?.getFileIcon?.(filePath),
      getNativeId: () => window.intools?.system?.getNativeId?.(),
      isDev: () => window.intools?.system?.isDev?.(),
      isMacOS: () => window.intools?.system?.isMacOS?.(),
      isWindows: () => window.intools?.system?.isWindows?.(),
      isLinux: () => window.intools?.system?.isLinux?.(),
    },

    // Permission API
    permission: {
      getStatus: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.intools?.permission?.getStatus(type),
      request: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.intools?.permission?.request(type),
      canRequest: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.intools?.permission?.canRequest(type),
      openSystemSettings: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        window.intools?.permission?.openSystemSettings(type),
      isAccessibilityTrusted: () => window.intools?.permission?.isAccessibilityTrusted()
    },

    // Power API
    power: {
      getSystemIdleTime: () => window.intools?.power?.getSystemIdleTime(),
      getSystemIdleState: (threshold: number) => window.intools?.power?.getSystemIdleState(threshold),
      isOnBatteryPower: () => window.intools?.power?.isOnBatteryPower(),
      getCurrentThermalState: () => window.intools?.power?.getCurrentThermalState(),
    },

    // Network API
    network: {
      isOnline: () => window.intools?.network?.isOnline(),
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
      speak: (text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }) =>
        window.intools?.tts?.speak(text, options),
      stop: () => window.intools?.tts?.stop(),
      pause: () => window.intools?.tts?.pause(),
      resume: () => window.intools?.tts?.resume(),
      getVoices: () => window.intools?.tts?.getVoices(),
      isSpeaking: () => window.intools?.tts?.isSpeaking(),
    },

    // Media API
    media: {
      getAccessStatus: (type: 'camera' | 'microphone') => window.intools?.media?.getAccessStatus(type),
      askForAccess: (type: 'camera' | 'microphone') => window.intools?.media?.askForAccess(type),
      hasCameraAccess: () => window.intools?.media?.hasCameraAccess(),
      hasMicrophoneAccess: () => window.intools?.media?.hasMicrophoneAccess(),
    },

    // Shortcut API
    shortcut: {
      register: (accelerator: string) => window.intools?.shortcut?.register(accelerator),
      unregister: (accelerator: string) => window.intools?.shortcut?.unregister(accelerator),
      unregisterAll: () => window.intools?.shortcut?.unregisterAll(),
      isRegistered: (accelerator: string) => window.intools?.shortcut?.isRegistered(accelerator),
    },

    // Security API
    security: {
      isEncryptionAvailable: () => window.intools?.security?.isEncryptionAvailable(),
      encryptString: (text: string) => window.intools?.security?.encryptString(text),
      decryptString: (data: ArrayBuffer) => window.intools?.security?.decryptString(data),
    },

    // Tray API
    tray: {
      create: (options: { icon: string; tooltip?: string; title?: string }) =>
        window.intools?.tray?.create(options),
      destroy: () => window.intools?.tray?.destroy(),
      setIcon: (icon: string) => window.intools?.tray?.setIcon(icon),
      setTooltip: (tooltip: string) => window.intools?.tray?.setTooltip(tooltip),
      setTitle: (title: string) => window.intools?.tray?.setTitle(title),
      exists: () => window.intools?.tray?.exists(),
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
      }[]) => window.intools?.menu?.showContextMenu(items as Parameters<typeof window.intools.menu.showContextMenu>[0]),
    },

    // Theme API
    theme: {
      get: () => window.intools?.theme?.get(),
      set: (mode: 'light' | 'dark' | 'system') => window.intools?.theme?.set(mode),
      getActual: () => window.intools?.theme?.getActual(),
    },

    // Host API
    host: {
      invoke: (method: string, ...args: unknown[]) =>
        window.intools?.host?.invoke(pluginId || '', method, ...args),
      call: (method: string, ...args: unknown[]) =>
        window.intools?.host?.call?.(pluginId || '', method, ...args),
      status: () => window.intools?.host?.status(pluginId || ''),
      restart: () => window.intools?.host?.restart(pluginId || ''),
    },

    // InBrowser API
    inbrowser: window.intools?.inbrowser,

    // Sharp API
    sharp: window.intools?.sharp,
    getSharpVersion: () => window.intools?.getSharpVersion?.(),

    // FFmpeg API
    ffmpeg: window.intools?.ffmpeg,
  }), [pluginId])
}
`
}
