import type { IpcRenderer } from 'electron'

export function createAiApi(ipcRenderer: IpcRenderer) {
  return (() => {
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
  })()
}
