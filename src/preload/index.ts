import { contextBridge, ipcRenderer } from 'electron'
import { inbrowser } from './inbrowser'
import { patchConsoleWithTimestamp } from '../shared/utils/console'
import type { InputPayload } from '../shared/types/plugin'

// 检测是否启用了 contextIsolation
// 当 contextIsolation 为 false 时，contextBridge 不可用，需要直接设置 window
const isContextIsolated = process.contextIsolated

patchConsoleWithTimestamp()

// 定义 mulby API 对象
const mulbyApi = {
  // 窗口控制
  window: {
    hide: (isRestorePreWindow?: boolean) => ipcRenderer.send('window:hide', isRestorePreWindow),
    show: () => ipcRenderer.send('window:show'),
    setSize: (width: number, height: number) =>
      ipcRenderer.send('window:setSize', width, height),
    setExpendHeight: (height: number, allowResize?: boolean) => ipcRenderer.send('window:setExpendHeight', height, allowResize),
    center: () => ipcRenderer.send('window:center'),
    // 插件窗口控制
    detach: () => ipcRenderer.send('plugin:detach'),
    close: () => ipcRenderer.send('plugin:close'),
    setAlwaysOnTop: (flag: boolean) => ipcRenderer.send('window:alwaysOnTop', flag),
    getMode: () => ipcRenderer.invoke('plugin:getMode'),
    getWindowType: () => ipcRenderer.invoke('window:getType'),
    // 独立窗口标题栏控制
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    getState: () => ipcRenderer.invoke('window:getState'),
    reload: () => ipcRenderer.send('plugin:reload'),
    create: async (url: string, options?: { width?: number; height?: number; title?: string }) => {
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
        postMessage: (channel: string, ...args: unknown[]) => ipcRenderer.invoke('window:child:action', id, 'postMessage', channel, ...args)
      }
    },
    // 窗口间通信
    sendToParent: (channel: string, ...args: unknown[]) =>
      ipcRenderer.send('window:sendToParent', channel, ...args),
    onChildMessage: (callback: (channel: string, ...args: unknown[]) => void) => {
      const listener = (_: any, channel: string, ...args: unknown[]) => callback(channel, ...args)
      ipcRenderer.on('window:childMessage', listener)
      return () => ipcRenderer.removeListener('window:childMessage', listener)
    },
    // 页面内查找
    findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) =>
      ipcRenderer.invoke('webContents:findInPage', text, options),
    stopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection') =>
      ipcRenderer.send('webContents:stopFindInPage', action),
    // 原生文件拖拽
    startDrag: (filePath: string | string[]) => ipcRenderer.send('window:startDrag', filePath)
  },

  // 子输入框 API (uTools 特色功能)
  subInput: {
    set: (placeholder?: string, isFocus?: boolean) =>
      ipcRenderer.invoke('subInput:set', placeholder, isFocus),
    remove: () => ipcRenderer.invoke('subInput:remove'),
    setValue: (text: string) => ipcRenderer.send('subInput:setValue', text),
    focus: () => ipcRenderer.send('subInput:focus'),
    blur: () => ipcRenderer.send('subInput:blur'),
    select: () => ipcRenderer.send('subInput:select'),
    onChange: (callback: (data: { text: string }) => void) => {
      const listener = (_: any, data: { text: string }) => callback(data)
      ipcRenderer.on('subInput:onChange', listener)
      return () => ipcRenderer.removeListener('subInput:onChange', listener)
    }
  },


  // 主题
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (mode: 'light' | 'dark' | 'system') => ipcRenderer.invoke('theme:set', mode),
    getActual: () => ipcRenderer.invoke('theme:getActual')
  },

  // 主题变化事件
  onThemeChange: (callback: (theme: 'light' | 'dark') => void) => {
    const listener = (_: any, theme: 'light' | 'dark') => callback(theme)
    ipcRenderer.on('theme:changed', listener)
    return () => ipcRenderer.removeListener('theme:changed', listener)
  },
  // AI
  ai: (() => {
    const call = (option: any, streamCallback?: (chunk: any) => void) => {
      if (!streamCallback) {
        const promise = ipcRenderer.invoke('ai:call', option)
        ;(promise as any).abort = () => {}
        return promise as any
      }

      let requestIdValue: string | null = null
      let settled = false
      const pendingEvents: Array<{ type: 'chunk' | 'end' | 'error'; id: string; payload: any }> = []

      let resolvePromise: ((value: any) => void) | null = null
      let rejectPromise: ((reason?: any) => void) | null = null

      const emitChunk = (chunk: any) => {
        try {
          streamCallback(chunk)
        } catch {
          // ignore user callback errors
        }
      }

      const maybeHandleEvent = (event: { type: 'chunk' | 'end' | 'error'; id: string; payload: any }) => {
        if (settled) return
        if (!requestIdValue) {
          pendingEvents.push(event)
          return
        }
        if (event.id !== requestIdValue) return
        if (event.type === 'chunk') {
          emitChunk(event.payload)
          return
        }
        settled = true
        cleanup()
        if (event.type === 'end') {
          resolvePromise?.(event.payload)
          return
        }
        rejectPromise?.(new Error(String(event.payload || 'AI stream failed')))
      }

      const onChunk = (_: any, id: string, chunk: any) => {
        maybeHandleEvent({ type: 'chunk', id, payload: chunk })
      }
      const onEnd = (_: any, id: string, message: any) => {
        maybeHandleEvent({ type: 'end', id, payload: message })
      }
      const onError = (_: any, id: string, error: string) => {
        maybeHandleEvent({ type: 'error', id, payload: error })
      }

      const cleanup = () => {
        ipcRenderer.removeListener('ai:stream:chunk', onChunk)
        ipcRenderer.removeListener('ai:stream:end', onEnd)
        ipcRenderer.removeListener('ai:stream:error', onError)
      }

      ipcRenderer.on('ai:stream:chunk', onChunk)
      ipcRenderer.on('ai:stream:end', onEnd)
      ipcRenderer.on('ai:stream:error', onError)

      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve
        rejectPromise = reject
      })

      const requestIdPromise = ipcRenderer.invoke('ai:stream', option)
        .then(({ requestId }) => {
          if (settled) return
          requestIdValue = requestId
          ;(promise as any).requestId = requestId
          emitChunk({ __requestId: requestId })
          if (pendingEvents.length > 0) {
            const queue = pendingEvents.splice(0, pendingEvents.length)
            for (const event of queue) {
              maybeHandleEvent(event)
              if (settled) break
            }
          }
        })
        .catch((error) => {
          if (settled) return
          settled = true
          cleanup()
          rejectPromise?.(error instanceof Error ? error : new Error(String(error)))
        })

      ;(promise as any).abort = () => {
        if (requestIdValue) {
          ipcRenderer.invoke('ai:abort', requestIdValue).catch(() => {})
          return
        }
        requestIdPromise
          .then(() => {
            if (requestIdValue) {
              return ipcRenderer.invoke('ai:abort', requestIdValue).catch(() => {})
            }
          })
          .catch(() => {})
      }

      return promise as any
    }

    return {
      call,
      allModels: () => ipcRenderer.invoke('ai:models:all'),
      testConnection: (input: any) => ipcRenderer.invoke('ai:test', input),
      testConnectionStream: (input: any, onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void) => {
        let abortFn = () => {}
        const promise = ipcRenderer.invoke('ai:test:stream', input).then(({ requestId }) => {
          abortFn = () => ipcRenderer.invoke('ai:abort', requestId)

          return new Promise((resolve, reject) => {
            const onData = (_: any, id: string, chunk: { type: 'content' | 'reasoning'; text: string }) => {
              if (id !== requestId) return
              onChunk(chunk)
            }
            const onEnd = (_: any, id: string, result: any) => {
              if (id !== requestId) return
              cleanup()
              resolve(result)
            }
            const onError = (_: any, id: string, error: string) => {
              if (id !== requestId) return
              cleanup()
              reject(new Error(error))
            }

            const cleanup = () => {
              ipcRenderer.removeListener('ai:test:chunk', onData)
              ipcRenderer.removeListener('ai:test:end', onEnd)
              ipcRenderer.removeListener('ai:test:error', onError)
            }

            ipcRenderer.on('ai:test:chunk', onData)
            ipcRenderer.on('ai:test:end', onEnd)
            ipcRenderer.on('ai:test:error', onError)
          })
        })

        ;(promise as any).abort = () => abortFn()
        return promise as any
      },
      models: {
        fetch: (input: any) => ipcRenderer.invoke('ai:models:fetch', input)
      },
      abort: (requestId: string) => ipcRenderer.invoke('ai:abort', requestId),
      settings: {
        get: () => ipcRenderer.invoke('ai:settings:get'),
        update: (next: any) => ipcRenderer.invoke('ai:settings:update', next)
      },
      mcp: {
        listServers: () => ipcRenderer.invoke('ai:mcp:servers:list'),
        getServer: (serverId: string) => ipcRenderer.invoke('ai:mcp:servers:get', serverId),
        upsertServer: (server: any) => ipcRenderer.invoke('ai:mcp:servers:upsert', server),
        removeServer: (serverId: string) => ipcRenderer.invoke('ai:mcp:servers:remove', serverId),
        activateServer: (serverId: string) => ipcRenderer.invoke('ai:mcp:servers:activate', serverId),
        deactivateServer: (serverId: string) => ipcRenderer.invoke('ai:mcp:servers:deactivate', serverId),
        restartServer: (serverId: string) => ipcRenderer.invoke('ai:mcp:servers:restart', serverId),
        checkServer: (serverId: string) => ipcRenderer.invoke('ai:mcp:servers:check', serverId),
        listTools: (serverId: string) => ipcRenderer.invoke('ai:mcp:tools:list', serverId),
        abort: (callId: string) => ipcRenderer.invoke('ai:mcp:abort', callId),
        getLogs: (serverId: string) => ipcRenderer.invoke('ai:mcp:logs:get', serverId)
      },
      skills: {
        list: () => ipcRenderer.invoke('ai:skills:list'),
        refresh: () => ipcRenderer.invoke('ai:skills:refresh'),
        listEnabled: () => ipcRenderer.invoke('ai:skills:list-enabled'),
        get: (skillId: string) => ipcRenderer.invoke('ai:skills:get', skillId),
        install: (input: any) => ipcRenderer.invoke('ai:skills:install', input),
        remove: (skillId: string) => ipcRenderer.invoke('ai:skills:remove', skillId),
        enable: (skillId: string) => ipcRenderer.invoke('ai:skills:enable', skillId),
        disable: (skillId: string) => ipcRenderer.invoke('ai:skills:disable', skillId),
        preview: (input: any) => ipcRenderer.invoke('ai:skills:preview', input),
        resolve: (option: any) => ipcRenderer.invoke('ai:skills:resolve', option)
      },
      attachments: {
        upload: (input: any) => ipcRenderer.invoke('ai:attachments:upload', input),
        get: (attachmentId: string) => ipcRenderer.invoke('ai:attachments:get', attachmentId),
        delete: (attachmentId: string) => ipcRenderer.invoke('ai:attachments:delete', attachmentId),
        uploadToProvider: (input: any) => ipcRenderer.invoke('ai:attachments:upload-provider', input)
      },
      tokens: {
        estimate: (input: any) => ipcRenderer.invoke('ai:tokens:estimate', input)
      },
      images: {
        generate: (input: any) => ipcRenderer.invoke('ai:images:generate', input),
        generateStream: (input: any, onChunk: (chunk: any) => void) => {
          let abortFn = () => {}
          const promise = ipcRenderer.invoke('ai:images:generate:stream', input).then(({ requestId }) => {
            abortFn = () => ipcRenderer.invoke('ai:abort', requestId)

            return new Promise((resolve, reject) => {
              const onData = (_: any, id: string, chunk: any) => {
                if (id !== requestId) return
                onChunk(chunk)
              }
              const onEnd = (_: any, id: string, result: any) => {
                if (id !== requestId) return
                cleanup()
                resolve(result)
              }
              const onError = (_: any, id: string, error: string) => {
                if (id !== requestId) return
                cleanup()
                reject(new Error(error))
              }

              const cleanup = () => {
                ipcRenderer.removeListener('ai:images:chunk', onData)
                ipcRenderer.removeListener('ai:images:end', onEnd)
                ipcRenderer.removeListener('ai:images:error', onError)
              }

              ipcRenderer.on('ai:images:chunk', onData)
              ipcRenderer.on('ai:images:end', onEnd)
              ipcRenderer.on('ai:images:error', onError)
            })
          })

          ;(promise as any).abort = () => abortFn()
          return promise as any
        },
        edit: (input: any) => ipcRenderer.invoke('ai:images:edit', input)
      }
    }
  })(),

  // App events
  app: {
    onOpenSettings: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:openSettings', listener)
      return () => ipcRenderer.removeListener('app:openSettings', listener)
    },
    onOpenAiSettings: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:openAiSettings', listener)
      return () => ipcRenderer.removeListener('app:openAiSettings', listener)
    },
    onOpenPluginStore: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:openPluginStore', listener)
      return () => ipcRenderer.removeListener('app:openPluginStore', listener)
    },
    onOpenPluginManager: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:openPluginManager', listener)
      return () => ipcRenderer.removeListener('app:openPluginManager', listener)
    },
    onOpenBackgroundPlugins: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:openBackgroundPlugins', listener)
      return () => ipcRenderer.removeListener('app:openBackgroundPlugins', listener)
    },
    onOpenTaskScheduler: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:openTaskScheduler', listener)
      return () => ipcRenderer.removeListener('app:openTaskScheduler', listener)
    },
    onOpenLogViewer: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:openLogViewer', listener)
      return () => ipcRenderer.removeListener('app:openLogViewer', listener)
    },
    onOpenCommandShortcuts: (callback: (payload?: { cmdLabel?: string }) => void) => {
      const listener = (_: any, payload?: { cmdLabel?: string }) => callback(payload)
      ipcRenderer.on('app:openCommandShortcuts', listener)
      return () => ipcRenderer.removeListener('app:openCommandShortcuts', listener)
    }
  },

  // 窗口状态变化事件
  onWindowStateChange: (callback: (state: { isMaximized: boolean }) => void) => {
    const listener = (_: any, state: { isMaximized: boolean }) => callback(state)
    ipcRenderer.on('window:stateChanged', listener)
    return () => ipcRenderer.removeListener('window:stateChanged', listener)
  },

  // 剪贴板
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

  // 输入 API
  input: {
    hideMainWindowPasteText: (text: string) => ipcRenderer.invoke('input:hideMainWindowPasteText', text),
    hideMainWindowPasteImage: (image: string | Buffer) => ipcRenderer.invoke('input:hideMainWindowPasteImage', image),
    hideMainWindowPasteFile: (filePaths: string | string[]) => ipcRenderer.invoke('input:hideMainWindowPasteFile', filePaths),
    hideMainWindowTypeString: (text: string) => ipcRenderer.invoke('input:hideMainWindowTypeString', text),
    restoreWindows: () => ipcRenderer.invoke('input:restoreWindows'),
    // 模拟按键 API
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

  // 通知
  notification: {
    show: (message: string, type?: string) =>
      ipcRenderer.send('notification:show', message, type)
  },

  // 插件
  plugin: {
    getAll: () => ipcRenderer.invoke('plugin:getAll'),
    listCommands: (pluginId?: string) => ipcRenderer.invoke('plugin:listCommands', pluginId),
    search: (query: string | InputPayload) => ipcRenderer.invoke('plugin:search', query),
    run: (name: string, featureCode: string, input?: string | InputPayload) =>
      ipcRenderer.invoke('plugin:run', name, featureCode, input),
    runCommand: (input: any) => ipcRenderer.invoke('plugin:runCommand', input),
    getRecentUsed: (limit?: number) => ipcRenderer.invoke('plugin:getRecentUsed', limit),
    install: (filePath: string) => ipcRenderer.invoke('plugin:install', filePath),
    enable: (name: string) => ipcRenderer.invoke('plugin:enable', name),
    disable: (name: string) => ipcRenderer.invoke('plugin:disable', name),
    uninstall: (name: string) => ipcRenderer.invoke('plugin:uninstall', name),
    getReadme: (name: string) => ipcRenderer.invoke('plugin:getReadme', name),
    // 后台插件 API
    listBackground: () => ipcRenderer.invoke('plugin:listBackground'),
    stopBackground: (pluginId: string) => ipcRenderer.invoke('plugin:stopBackground', pluginId),
    getBackgroundInfo: (pluginId: string) => ipcRenderer.invoke('plugin:getBackgroundInfo', pluginId),
    startBackground: (pluginId: string) => ipcRenderer.invoke('plugin:startBackground', pluginId),
    stopPlugin: (pluginId: string) => ipcRenderer.invoke('plugin:stopPlugin', pluginId),
    listCommandShortcuts: (pluginId?: string) => ipcRenderer.invoke('plugin:commandShortcut:list', pluginId),
    bindCommandShortcut: (input: any) => ipcRenderer.invoke('plugin:commandShortcut:bind', input),
    unbindCommandShortcut: (bindingId: string) => ipcRenderer.invoke('plugin:commandShortcut:unbind', bindingId),
    validateCommandShortcut: (accelerator: string, bindingId?: string) =>
      ipcRenderer.invoke('plugin:commandShortcut:validate', accelerator, bindingId),
    setCommandDisabled: (input: any) => ipcRenderer.invoke('plugin:command:setDisabled', input),
    // 插件导航 API
    redirect: (label: string | [string, string], payload?: unknown) =>
      ipcRenderer.invoke('plugin:redirect', label, payload),
    outPlugin: (isKill?: boolean) => ipcRenderer.invoke('plugin:out', isKill)
  },

  pluginStore: {
    fetch: () => ipcRenderer.invoke('plugin:store:fetch'),
    installFromUrl: (input: any) => ipcRenderer.invoke('plugin:store:installFromUrl', input),
    checkUpdatesInstalled: () => ipcRenderer.invoke('plugin:store:checkUpdatesInstalled'),
    updateAll: (pluginIds?: string[]) => ipcRenderer.invoke('plugin:store:updateAll', pluginIds)
  },

  // 任务调度器 API
  scheduler: {
    listTasks: (filter?: { pluginId?: string; status?: string; type?: string; limit?: number; offset?: number }) =>
      ipcRenderer.invoke('scheduler:listTasks', filter),
    getTaskCount: (filter?: { pluginId?: string; status?: string; type?: string }) =>
      ipcRenderer.invoke('scheduler:getTaskCount', filter),
    getTask: (taskId: string) => ipcRenderer.invoke('scheduler:getTask', taskId),
    schedule: (task: any) => ipcRenderer.invoke('scheduler:schedule', task),
    cancelTask: (taskId: string) => ipcRenderer.invoke('scheduler:cancelTask', taskId),
    pauseTask: (taskId: string) => ipcRenderer.invoke('scheduler:pauseTask', taskId),
    resumeTask: (taskId: string) => ipcRenderer.invoke('scheduler:resumeTask', taskId),
    deleteTasks: (taskIds: string[]) => ipcRenderer.invoke('scheduler:deleteTasks', taskIds),
    cleanupTasks: (olderThan?: number) => ipcRenderer.invoke('scheduler:cleanupTasks', olderThan),
    getExecutions: (taskId: string, limit?: number) =>
      ipcRenderer.invoke('scheduler:getExecutions', taskId, limit),
    validateCron: (expression: string) => ipcRenderer.invoke('scheduler:validateCron', expression),
    getNextCronTime: (expression: string, after?: Date) =>
      ipcRenderer.invoke('scheduler:getNextCronTime', expression, after),
    describeCron: (expression: string) => ipcRenderer.invoke('scheduler:describeCron', expression)
  },

  // 插件窗口事件
  onPluginInit: (callback: (data: { pluginName: string; featureCode: string; input: string; mode?: string }) => void) => {
    const listener = (_: any, data: { pluginName: string; featureCode: string; input: string; mode?: string }) => callback(data)
    ipcRenderer.on('plugin:init', listener)
    return () => ipcRenderer.removeListener('plugin:init', listener)
  },

  // 插件附着事件（主窗口使用）
  onPluginAttach: (callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string; preloadPath: string }) => void) => {
    const listener = (_: any, data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string; preloadPath: string }) => callback(data)
    ipcRenderer.on('plugin:attach', listener)
    return () => ipcRenderer.removeListener('plugin:attach', listener)
  },

  // 插件分离事件（主窗口使用）
  onPluginDetached: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('plugin:detached', listener)
    return () => ipcRenderer.removeListener('plugin:detached', listener)
  },

  // 屏幕 API
  screen: {
    getAllDisplays: () => ipcRenderer.invoke('screen:getAllDisplays'),
    getPrimaryDisplay: () => ipcRenderer.invoke('screen:getPrimaryDisplay'),
    getDisplayNearestPoint: (point: { x: number; y: number }) =>
      ipcRenderer.invoke('screen:getDisplayNearestPoint', point),
    getDisplayMatching: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('screen:getDisplayMatching', rect),
    getCursorScreenPoint: () => ipcRenderer.invoke('screen:getCursorScreenPoint'),
    getSources: (options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }) =>
      ipcRenderer.invoke('screen:getSources', options),
    capture: (options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }) =>
      ipcRenderer.invoke('screen:capture', options),
    captureRegion: (
      region: { x: number; y: number; width: number; height: number },
      options?: { format?: 'png' | 'jpeg'; quality?: number }
    ) => ipcRenderer.invoke('screen:captureRegion', region, options),
    getMediaStreamConstraints: (options: { sourceId: string; audio?: boolean; frameRate?: number }) =>
      ipcRenderer.invoke('screen:getMediaStreamConstraints', options),
    screenCapture: () => ipcRenderer.invoke('screen:startRegionCapture'),
    colorPick: () => ipcRenderer.invoke('screen:colorPick')
  },

  // Shell API
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
    openFolder: (path: string) => ipcRenderer.invoke('shell:openFolder', path),
    trashItem: (path: string) => ipcRenderer.invoke('shell:trashItem', path),
    beep: () => ipcRenderer.invoke('shell:beep'),
    runCommand: (input: any) => ipcRenderer.invoke('shell:runCommand', input),
    getRunCommandPolicy: () => ipcRenderer.invoke('shell:getRunCommandPolicy'),
    updateRunCommandPolicy: (patch: any) => ipcRenderer.invoke('shell:updateRunCommandPolicy', patch),
    listRunCommandAudit: (limit?: number) => ipcRenderer.invoke('shell:listRunCommandAudit', limit),
    clearRunCommandAudit: () => ipcRenderer.invoke('shell:clearRunCommandAudit'),
    clearRunCommandTrusted: () => ipcRenderer.invoke('shell:clearRunCommandTrusted')
  },

  // Desktop API
  desktop: {
    searchFiles: (query: string, limit?: number) => ipcRenderer.invoke('desktop:searchFiles', query, limit),
    searchApps: (query: string, limit?: number) => ipcRenderer.invoke('desktop:searchApps', query, limit)
  },

  // Filesystem API
  filesystem: {
    readFile: (path: string, encoding?: 'utf-8' | 'base64') =>
      ipcRenderer.invoke('filesystem:readFile', path, encoding),
    writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') =>
      ipcRenderer.invoke('filesystem:writeFile', path, data, encoding),
    exists: (path: string) => ipcRenderer.invoke('filesystem:exists', path),
    readdir: (path: string) => ipcRenderer.invoke('filesystem:readdir', path),
    mkdir: (path: string) => ipcRenderer.invoke('filesystem:mkdir', path),
    stat: (path: string) => ipcRenderer.invoke('filesystem:stat', path),
    copy: (src: string, dest: string) => ipcRenderer.invoke('filesystem:copy', src, dest),
    move: (src: string, dest: string) => ipcRenderer.invoke('filesystem:move', src, dest),
    unlink: (path: string) => ipcRenderer.invoke('filesystem:unlink', path)
  },

  // Dialog API
  dialog: {
    showOpenDialog: (options?: {
      title?: string
      defaultPath?: string
      buttonLabel?: string
      filters?: { name: string; extensions: string[] }[]
      properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
    }) => ipcRenderer.invoke('dialog:showOpenDialog', options),
    showSaveDialog: (options?: {
      title?: string
      defaultPath?: string
      buttonLabel?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    showMessageBox: (options: {
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
      title?: string
      message: string
      detail?: string
      buttons?: string[]
      defaultId?: number
      cancelId?: number
    }) => ipcRenderer.invoke('dialog:showMessageBox', options),
    showErrorBox: (title: string, content: string) =>
      ipcRenderer.invoke('dialog:showErrorBox', title, content)
  },

  // System API
  system: {
    getSystemInfo: () => ipcRenderer.invoke('system:getSystemInfo'),
    getAppInfo: () => ipcRenderer.invoke('system:getAppInfo'),
    getPath: (name: string) => ipcRenderer.invoke('system:getPath', name),
    getEnv: (name: string) => ipcRenderer.invoke('system:getEnv', name),
    getIdleTime: () => ipcRenderer.invoke('system:getIdleTime'),
    getFileIcon: (
      filePath: string,
      options?: { size?: number; kind?: 'app' | 'file' }
    ) => ipcRenderer.invoke('system:getFileIcon', filePath, options),
    getFileIcons: (
      requests: Array<{ key: string; path: string; kind?: 'app' | 'file'; size?: number }>,
      options?: { size?: number; concurrency?: number }
    ) => ipcRenderer.invoke('system:getFileIcons', requests, options),
    getNativeId: () => ipcRenderer.invoke('system:getNativeId'),
    isDev: () => ipcRenderer.invoke('system:isDev'),
    isMacOS: () => ipcRenderer.invoke('system:isMacOS'),
    isWindows: () => ipcRenderer.invoke('system:isWindows'),
    isLinux: () => ipcRenderer.invoke('system:isLinux')
  },

  // Permission API
  permission: {
    getStatus: (type: string) => ipcRenderer.invoke('permission:getStatus', type),
    request: (type: string) => ipcRenderer.invoke('permission:request', type),
    canRequest: (type: string) => ipcRenderer.invoke('permission:canRequest', type),
    openSystemSettings: (type: string) => ipcRenderer.invoke('permission:openSystemSettings', type),
    isAccessibilityTrusted: () => ipcRenderer.invoke('permission:isAccessibilityTrusted')
  },

  // GlobalShortcut API
  shortcut: {
    register: (accelerator: string) => ipcRenderer.invoke('shortcut:register', accelerator),
    unregister: (accelerator: string) => ipcRenderer.invoke('shortcut:unregister', accelerator),
    unregisterAll: () => ipcRenderer.invoke('shortcut:unregisterAll'),
    isRegistered: (accelerator: string) => ipcRenderer.invoke('shortcut:isRegistered', accelerator),
    onTriggered: (callback: (accelerator: string) => void) => {
      const listener = (_: any, accelerator: string) => callback(accelerator)
      ipcRenderer.on('shortcut:triggered', listener)
      return () => ipcRenderer.removeListener('shortcut:triggered', listener)
    }
  },

  // Security API
  security: {
    isEncryptionAvailable: () => ipcRenderer.invoke('security:isEncryptionAvailable'),
    encryptString: (plainText: string) => ipcRenderer.invoke('security:encryptString', plainText),
    decryptString: (encrypted: Buffer) => ipcRenderer.invoke('security:decryptString', encrypted)
  },

  // Storage API
  storage: {
    get: (key: string, namespace?: string) => ipcRenderer.invoke('storage:get', key, namespace),
    set: (key: string, value: unknown, namespace?: string) => ipcRenderer.invoke('storage:set', key, value, namespace),
    remove: (key: string, namespace?: string) => ipcRenderer.invoke('storage:remove', key, namespace)
  },

  // App settings API
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (partial: unknown) => ipcRenderer.invoke('settings:update', partial),
    reset: () => ipcRenderer.invoke('settings:reset'),
    pauseShortcuts: () => ipcRenderer.invoke('settings:shortcuts:pause'),
    resumeShortcuts: () => ipcRenderer.invoke('settings:shortcuts:resume')
  },

  // 开发者模式 API
  developer: {
    addPluginPath: (path: string) => ipcRenderer.invoke('developer:addPluginPath', path),
    removePluginPath: (path: string) => ipcRenderer.invoke('developer:removePluginPath', path),
    reloadPlugins: () => ipcRenderer.invoke('developer:reloadPlugins'),
    selectDirectory: () => ipcRenderer.invoke('developer:selectDirectory')
  },

  // Media API
  media: {
    getAccessStatus: (mediaType: 'microphone' | 'camera') =>
      ipcRenderer.invoke('media:getAccessStatus', mediaType),
    askForAccess: (mediaType: 'microphone' | 'camera') =>
      ipcRenderer.invoke('media:askForAccess', mediaType),
    hasCameraAccess: () => ipcRenderer.invoke('media:hasCameraAccess'),
    hasMicrophoneAccess: () => ipcRenderer.invoke('media:hasMicrophoneAccess')
  },

  // Power API
  power: {
    getSystemIdleTime: () => ipcRenderer.invoke('power:getSystemIdleTime'),
    getSystemIdleState: (idleThreshold: number) =>
      ipcRenderer.invoke('power:getSystemIdleState', idleThreshold),
    isOnBatteryPower: () => ipcRenderer.invoke('power:isOnBatteryPower'),
    getCurrentThermalState: () => ipcRenderer.invoke('power:getCurrentThermalState'),
    onSuspend: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('power:suspend', listener)
      return () => ipcRenderer.removeListener('power:suspend', listener)
    },
    onResume: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('power:resume', listener)
      return () => ipcRenderer.removeListener('power:resume', listener)
    },
    onAC: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('power:on-ac', listener)
      return () => ipcRenderer.removeListener('power:on-ac', listener)
    },
    onBattery: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('power:on-battery', listener)
      return () => ipcRenderer.removeListener('power:on-battery', listener)
    },
    onLockScreen: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('power:lock-screen', listener)
      return () => ipcRenderer.removeListener('power:lock-screen', listener)
    },
    onUnlockScreen: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('power:unlock-screen', listener)
      return () => ipcRenderer.removeListener('power:unlock-screen', listener)
    }
  },

  // Tray API
  tray: {
    create: (options: { icon: string; tooltip?: string; title?: string }) =>
      ipcRenderer.invoke('tray:create', options),
    destroy: () => ipcRenderer.invoke('tray:destroy'),
    setIcon: (icon: string) => ipcRenderer.invoke('tray:setIcon', icon),
    setTooltip: (tooltip: string) => ipcRenderer.invoke('tray:setTooltip', tooltip),
    setTitle: (title: string) => ipcRenderer.invoke('tray:setTitle', title),
    exists: () => ipcRenderer.invoke('tray:exists')
  },

  // App Tray Menu API（主程序托盘自定义菜单）
  trayMenu: {
    getState: () => ipcRenderer.invoke('tray-menu:getState'),
    action: (action: string, payload?: Record<string, unknown>) => ipcRenderer.invoke('tray-menu:action', action, payload),
    close: () => ipcRenderer.invoke('tray-menu:close'),
    onState: (callback: (state: unknown) => void) => {
      const listener = (_: any, state: unknown) => callback(state)
      ipcRenderer.on('tray-menu:state', listener)
      return () => ipcRenderer.removeListener('tray-menu:state', listener)
    }
  },

  // HTTP API
  http: {
    request: (options: any) => ipcRenderer.invoke('http:request', options),
    get: (url: string, headers?: Record<string, string>) => ipcRenderer.invoke('http:get', url, headers),
    post: (url: string, body?: any, headers?: Record<string, string>) => ipcRenderer.invoke('http:post', url, body, headers),
    put: (url: string, body?: any, headers?: Record<string, string>) => ipcRenderer.invoke('http:put', url, body, headers),
    delete: (url: string, headers?: Record<string, string>) => ipcRenderer.invoke('http:delete', url, headers)
  },

  // Network API
  network: {
    isOnline: () => ipcRenderer.invoke('network:isOnline'),
    onOnline: (callback: () => void) => {
      window.addEventListener('online', callback)
    },
    onOffline: (callback: () => void) => {
      window.addEventListener('offline', callback)
    }
  },

  // Menu API
  menu: {
    showContextMenu: (items: {
      label: string
      type?: 'normal' | 'separator' | 'checkbox' | 'radio'
      checked?: boolean
      enabled?: boolean
      id?: string
      submenu?: any[]
    }[]) => ipcRenderer.invoke('menu:showContextMenu', items)
  },

  // Geolocation API
  // 注意: 使用主进程定位（macOS 原生优先，IP 定位后备）
  geolocation: {
    getAccessStatus: () => ipcRenderer.invoke('geolocation:getAccessStatus'),
    requestAccess: () => ipcRenderer.invoke('geolocation:requestAccess'),
    canGetPosition: () => ipcRenderer.invoke('geolocation:canGetPosition'),
    openSettings: () => ipcRenderer.invoke('geolocation:openSettings'),
    getCurrentPosition: () => {
      console.log('[Geolocation] getCurrentPosition called (using IPC)')
      return ipcRenderer.invoke('geolocation:getCurrentPosition')
    }
  },

  // TTS API
  tts: {
    speak: (text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }) => {
      return new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text)
        if (options?.lang) utterance.lang = options.lang
        if (options?.rate) utterance.rate = options.rate
        if (options?.pitch) utterance.pitch = options.pitch
        if (options?.volume) utterance.volume = options.volume
        utterance.onend = () => resolve()
        utterance.onerror = (e) => reject(e)
        speechSynthesis.speak(utterance)
      })
    },
    stop: () => speechSynthesis.cancel(),
    pause: () => speechSynthesis.pause(),
    resume: () => speechSynthesis.resume(),
    getVoices: () => speechSynthesis.getVoices().map(v => ({
      name: v.name,
      lang: v.lang,
      default: v.default,
      localService: v.localService
    })),
    isSpeaking: () => speechSynthesis.speaking
  },

  // Plugin Host API（插件 UI 与后端通信）
  host: {
    invoke: (pluginName: string, method: string, ...args: unknown[]) =>
      ipcRenderer.invoke('host:invoke', pluginName, method, ...args),
    call: (pluginName: string, method: string, ...args: unknown[]) =>
      ipcRenderer.invoke('host:call', pluginName, method, ...args),
    status: (pluginName: string) =>
      ipcRenderer.invoke('host:status', pluginName),
    restart: (pluginName: string) =>
      ipcRenderer.invoke('host:restart', pluginName)
  },

  // 可编程浏览器 API
  inbrowser: inbrowser,

  // Sharp 图像处理 API
  // 由于 contextBridge 无法传递 Proxy 对象，使用可序列化的链式构建器模式
  sharp: (input?: string | Buffer | ArrayBuffer | Uint8Array | object | any[], options?: object) => {
    // 操作链记录
    const operations: { method: string; args: any[] }[] = []

    // 创建链式构建器 - 使用普通对象替代 Proxy
    const createBuilder = (): any => {
      // 执行 IPC 调用
      const executeIpc = async () => {
        return ipcRenderer.invoke('sharp:execute', { input, options, operations })
      }

      // 创建可序列化的构建器对象
      const builder: Record<string, any> = {}

      // 终结方法
      const terminalMethods = ['toBuffer', 'toFile', 'metadata', 'stats']
      terminalMethods.forEach(method => {
        builder[method] = async (...args: any[]) => {
          operations.push({ method, args })
          return executeIpc()
        }
      })

      // 链式方法列表
      const chainMethods = [
        // 尺寸调整
        'resize', 'extend', 'extract', 'trim',
        // 变换
        'rotate', 'flip', 'flop', 'affine',
        // 图像处理
        'median', 'blur', 'sharpen', 'flatten', 'gamma', 'negate',
        'normalise', 'normalize', 'clahe', 'convolve', 'threshold',
        'linear', 'recomb', 'modulate',
        // 颜色
        'tint', 'greyscale', 'grayscale', 'pipelineColorspace', 'toColorspace',
        // 通道
        'removeAlpha', 'ensureAlpha', 'extractChannel', 'joinChannel', 'bandbool',
        // 合成
        'composite',
        // 输出格式
        'png', 'jpeg', 'webp', 'gif', 'tiff', 'avif', 'heif', 'raw',
        // 元数据
        'withMetadata', 'keepExif', 'withExif', 'keepIccProfile', 'withIccProfile',
        // 其他
        'timeout', 'tile'
      ]

      chainMethods.forEach(method => {
        builder[method] = (...args: any[]) => {
          operations.push({ method, args })
          return builder // 返回同一个 builder 实现链式调用
        }
      })

      // clone 方法特殊处理
      builder.clone = () => {
        // 创建一个新的 builder，复制当前操作链
        const clonedOps = [...operations]
        const newBuilder = createBuilder()
        clonedOps.forEach(op => operations.push(op))
        return newBuilder
      }

      return builder
    }

    return createBuilder()
  },

  // Sharp 版本信息
  getSharpVersion: () => ipcRenderer.invoke('sharp:version'),

  // FFmpeg 音视频处理 API
  // 实现 uTools 风格的 runFFmpeg API
  ffmpeg: {
    /**
     * 检查 FFmpeg 是否可用
     */
    isAvailable: () => ipcRenderer.invoke('ffmpeg:isAvailable'),

    /**
     * 获取 FFmpeg 版本
     */
    getVersion: () => ipcRenderer.invoke('ffmpeg:getVersion'),

    /**
     * 获取 FFmpeg 可执行文件路径
     */
    getPath: () => ipcRenderer.invoke('ffmpeg:getPath'),

    /**
     * 下载并安装 FFmpeg
     * @param onProgress 下载进度回调
     */
    download: (onProgress?: (progress: { phase: 'downloading' | 'extracting' | 'done'; percent: number; downloaded?: number; total?: number }) => void) => {
      // 监听下载进度
      if (onProgress) {
        const listener = (_: any, progress: any) => onProgress(progress)
        ipcRenderer.on('ffmpeg:downloadProgress', listener)
        // 下载完成后移除监听
        return ipcRenderer.invoke('ffmpeg:download').finally(() => {
          ipcRenderer.removeListener('ffmpeg:downloadProgress', listener)
        })
      }
      return ipcRenderer.invoke('ffmpeg:download')
    },

    /**
     * 执行 FFmpeg 命令
     * 返回扩展的 Promise，包含 kill() 和 quit() 方法
     * @param args FFmpeg 参数数组
     * @param onProgress 进度回调
     */
    run: (args: string[], onProgress?: (progress: { bitrate: string; fps: number; frame: number; percent?: number; q: number | string; size: string; speed: string; time: string }) => void) => {
      // 生成唯一的 taskId
      const taskId = `ffmpeg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      console.log('[FFmpeg Preload] run() 启动任务, taskId:', taskId)

      // 监听进度
      let progressListener: ((...args: any[]) => void) | null = null
      if (onProgress) {
        progressListener = (_: any, data: { taskId: string; progress: any }) => {
          // 只处理匹配的 taskId
          if (data.taskId === taskId) {
            onProgress(data.progress)
          }
        }
        ipcRenderer.on('ffmpeg:progress', progressListener)
      }

      // 执行命令
      const resultPromise = ipcRenderer.invoke('ffmpeg:run', { args, taskId }).finally(() => {
        // 清理监听器
        if (progressListener) {
          ipcRenderer.removeListener('ffmpeg:progress', progressListener)
        }
      })

      // 返回包含控制方法的对象（而非扩展 Promise，以避免 contextBridge 序列化问题）
      return {
        promise: resultPromise,
        kill: () => {
          console.log('[FFmpeg Preload] kill() 被调用, taskId:', taskId)
          ipcRenderer.invoke('ffmpeg:kill', taskId)
        },
        quit: () => {
          console.log('[FFmpeg Preload] quit() 被调用, taskId:', taskId)
          ipcRenderer.invoke('ffmpeg:quit', taskId)
        }
      }
    }
  },

  // 日志 API（开发者模式下记录插件日志）
  log: {
    debug: (message: string, ...args: unknown[]) =>
      ipcRenderer.send('log:write', 'debug', message, args),
    info: (message: string, ...args: unknown[]) =>
      ipcRenderer.send('log:write', 'info', message, args),
    warn: (message: string, ...args: unknown[]) =>
      ipcRenderer.send('log:write', 'warn', message, args),
    error: (message: string, ...args: unknown[]) =>
      ipcRenderer.send('log:write', 'error', message, args),
    // 获取日志（用于日志查看器）
    getLogs: (options?: { pluginId?: string; level?: string; limit?: number }) =>
      ipcRenderer.invoke('log:getLogs', options),
    // 清除日志
    clear: (pluginId?: string) =>
      ipcRenderer.invoke('log:clear', pluginId),
    // 获取日志目录
    getLogsDir: () =>
      ipcRenderer.invoke('log:getLogsDir'),
    // 订阅实时日志
    subscribe: () =>
      ipcRenderer.invoke('log:subscribe'),
    onLog: (callback: (entry: { timestamp: number; level: string; pluginId: string; message: string; args?: unknown[] }) => void) => {
      const listener = (_: any, entry: { timestamp: number; level: string; pluginId: string; message: string; args?: unknown[] }) => callback(entry)
      ipcRenderer.on('log:new', listener)
      return () => ipcRenderer.removeListener('log:new', listener)
    }
  }
}

// 主窗口专用 API（用于 SubInput 等功能）
const mulbyMainApi = {
  // SubInput 事件监听（主窗口接收插件发来的控制指令）
  subInput: {
    onEnabled: (callback: (data: { placeholder: string; isFocus: boolean }) => void) => {
      const listener = (_: any, data: { placeholder: string; isFocus: boolean }) => callback(data)
      ipcRenderer.on('subInput:enabled', listener)
      return () => ipcRenderer.removeListener('subInput:enabled', listener)
    },
    onDisabled: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('subInput:disabled', listener)
      return () => ipcRenderer.removeListener('subInput:disabled', listener)
    },
    onSetValue: (callback: (text: string) => void) => {
      const listener = (_: any, text: string) => callback(text)
      ipcRenderer.on('subInput:setValue', listener)
      return () => ipcRenderer.removeListener('subInput:setValue', listener)
    },
    onFocus: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('subInput:focus', listener)
      return () => ipcRenderer.removeListener('subInput:focus', listener)
    },
    onBlur: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('subInput:blur', listener)
      return () => ipcRenderer.removeListener('subInput:blur', listener)
    },
    onSelect: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('subInput:select', listener)
      return () => ipcRenderer.removeListener('subInput:select', listener)
    },
    // 主窗口输入变化时发送给主进程（转发给插件）
    sendChange: (text: string) => {
      ipcRenderer.send('subInput:change', text)
    }
  },
  // 剪贴板自动粘贴事件
  clipboard: {
    onAutoPaste: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('clipboard:autoPaste', listener)
      return () => ipcRenderer.removeListener('clipboard:autoPaste', listener)
    }
  }
}

// 根据 contextIsolation 状态选择暴露方式
if (isContextIsolated) {
  // contextIsolation 启用时，使用 contextBridge（安全模式）
  contextBridge.exposeInMainWorld('mulby', mulbyApi)
  contextBridge.exposeInMainWorld('mulbyMain', mulbyMainApi)
} else {
  // contextIsolation 禁用时，直接设置 window 属性（自定义 preload 模式）
  // @ts-ignore - 在非隔离模式下直接访问 window
  window.mulby = mulbyApi
  // @ts-ignore
  window.mulbyMain = mulbyMainApi
}

// ==================== 自动错误捕获（开发者模式） ====================
// 捕获渲染进程中的错误，发送到主进程日志系统
// 这样崩溃前的错误信息可以被记录下来

// 保存原始 console 方法
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

// 拦截 console.error
console.error = (...args: unknown[]) => {
  // 调用原始方法
  originalConsoleError.apply(console, args)
  // 发送到主进程日志
  try {
    const message = args.map(arg => {
      if (arg instanceof Error) {
        return `${arg.message}\n${arg.stack || ''}`
      }
      return typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    }).join(' ')
    ipcRenderer.send('log:write', 'error', message)
  } catch {
    // 忽略序列化错误
  }
}

// 拦截 console.warn
console.warn = (...args: unknown[]) => {
  originalConsoleWarn.apply(console, args)
  try {
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ')
    ipcRenderer.send('log:write', 'warn', message)
  } catch {
    // 忽略序列化错误
  }
}

// 捕获未捕获的异常
window.addEventListener('error', (event) => {
  try {
    const message = event.error
      ? `${event.error.message}\n${event.error.stack || ''}`
      : `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
    ipcRenderer.send('log:write', 'error', `[Uncaught Error] ${message}`)
  } catch {
    ipcRenderer.send('log:write', 'error', '[Uncaught Error] (failed to serialize)')
  }
})

// 捕获未处理的 Promise 拒绝
window.addEventListener('unhandledrejection', (event) => {
  try {
    const reason = event.reason
    const message = reason instanceof Error
      ? `${reason.message}\n${reason.stack || ''}`
      : typeof reason === 'object' ? JSON.stringify(reason) : String(reason)
    ipcRenderer.send('log:write', 'error', `[Unhandled Rejection] ${message}`)
  } catch {
    ipcRenderer.send('log:write', 'error', '[Unhandled Rejection] (failed to serialize)')
  }
})
