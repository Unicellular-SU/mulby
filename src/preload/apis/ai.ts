import type { IpcRenderer } from 'electron'
import type {
  AiApi,
  AiImageGenerateProgressChunk,
  AiMessage,
  AiPromiseLike
} from '../../shared/types/ai'

type StreamEvent =
  | { type: 'chunk'; id: string; payload: AiMessage }
  | { type: 'end'; id: string; payload: AiMessage }
  | { type: 'error'; id: string; payload: string }

type AbortableWithRequestId<T> = AiPromiseLike<T> & { requestId?: string }

function toAbortablePromise<T>(promise: Promise<T>, abort: () => void): AiPromiseLike<T> {
  const abortable = promise as AiPromiseLike<T>
  abortable.abort = abort
  return abortable
}

export function createAiApi(ipcRenderer: IpcRenderer) {
  return (() => {
    const call: AiApi['call'] = (option, streamCallback) => {
      if (!streamCallback) {
        const promise = ipcRenderer.invoke('ai:call', option) as Promise<AiMessage>
        return toAbortablePromise(promise, () => {})
      }

      let requestIdValue: string | null = null
      let settled = false
      const pendingEvents: StreamEvent[] = []

      let resolvePromise: ((value: AiMessage) => void) | null = null
      let rejectPromise: ((reason?: unknown) => void) | null = null

      const emitChunk = (chunk: AiMessage) => {
        try {
          streamCallback(chunk)
        } catch {
          // ignore user callback errors
        }
      }

      const cleanup = () => {
        ipcRenderer.removeListener('ai:stream:chunk', onChunk)
        ipcRenderer.removeListener('ai:stream:end', onEnd)
        ipcRenderer.removeListener('ai:stream:error', onError)
      }

      const maybeHandleEvent = (event: StreamEvent) => {
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

      const onChunk = (_event: unknown, id: string, chunk: AiMessage) => {
        maybeHandleEvent({ type: 'chunk', id, payload: chunk })
      }
      const onEnd = (_event: unknown, id: string, message: AiMessage) => {
        maybeHandleEvent({ type: 'end', id, payload: message })
      }
      const onError = (_event: unknown, id: string, error: string) => {
        maybeHandleEvent({ type: 'error', id, payload: error })
      }

      ipcRenderer.on('ai:stream:chunk', onChunk)
      ipcRenderer.on('ai:stream:end', onEnd)
      ipcRenderer.on('ai:stream:error', onError)

      const basePromise = new Promise<AiMessage>((resolve, reject) => {
        resolvePromise = resolve
        rejectPromise = reject
      })
      const streamPromise = toAbortablePromise(basePromise, () => {}) as AbortableWithRequestId<AiMessage>

      const requestIdPromise = (ipcRenderer.invoke('ai:stream', option) as Promise<{ requestId: string }>)
        .then(({ requestId }) => {
          if (settled) return
          requestIdValue = requestId
          streamPromise.requestId = requestId
          emitChunk({ __requestId: requestId } as unknown as AiMessage)
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

      streamPromise.abort = () => {
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

      return streamPromise
    }

    const testConnectionStream: AiApi['testConnectionStream'] = (input, onChunk) => {
      let abortFn = () => {}
      const promise = (ipcRenderer.invoke('ai:test:stream', input) as Promise<{ requestId: string }>).then(({ requestId }) => {
        abortFn = () => {
          void ipcRenderer.invoke('ai:abort', requestId)
        }

        return new Promise<{ success: boolean; message?: string; reasoning?: string }>((resolve, reject) => {
          const onData = (_event: unknown, id: string, chunk: { type: 'content' | 'reasoning'; text: string }) => {
            if (id !== requestId) return
            onChunk(chunk)
          }
          const onEnd = (
            _event: unknown,
            id: string,
            result: { success: boolean; message?: string; reasoning?: string }
          ) => {
            if (id !== requestId) return
            cleanup()
            resolve(result)
          }
          const onError = (_event: unknown, id: string, error: string) => {
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

      return toAbortablePromise(promise, () => abortFn())
    }

    const generateImageStream: AiApi['images']['generateStream'] = (input, onChunk) => {
      let abortFn = () => {}
      const promise = (ipcRenderer.invoke('ai:images:generate:stream', input) as Promise<{ requestId: string }>).then(
        ({ requestId }) => {
          abortFn = () => {
            void ipcRenderer.invoke('ai:abort', requestId)
          }

          return new Promise<{ images: string[]; tokens: { inputTokens: number; outputTokens: number } }>((resolve, reject) => {
            const onData = (_event: unknown, id: string, chunk: AiImageGenerateProgressChunk) => {
              if (id !== requestId) return
              onChunk(chunk)
            }
            const onEnd = (
              _event: unknown,
              id: string,
              result: { images: string[]; tokens: { inputTokens: number; outputTokens: number } }
            ) => {
              if (id !== requestId) return
              cleanup()
              resolve(result)
            }
            const onError = (_event: unknown, id: string, error: string) => {
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
        }
      )

      return toAbortablePromise(promise, () => abortFn())
    }

    const api: AiApi = {
      call,
      allModels: () => ipcRenderer.invoke('ai:models:all'),
      testConnection: (input) => ipcRenderer.invoke('ai:test', input),
      testConnectionStream,
      models: {
        fetch: (input) => ipcRenderer.invoke('ai:models:fetch', input)
      },
      abort: (requestId: string) => ipcRenderer.invoke('ai:abort', requestId),
      settings: {
        get: () => ipcRenderer.invoke('ai:settings:get'),
        update: (next) => ipcRenderer.invoke('ai:settings:update', next)
      },
      mcp: {
        listServers: () => ipcRenderer.invoke('ai:mcp:servers:list'),
        getServer: (serverId: string) => ipcRenderer.invoke('ai:mcp:servers:get', serverId),
        upsertServer: (server) => ipcRenderer.invoke('ai:mcp:servers:upsert', server),
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
        install: (input) => ipcRenderer.invoke('ai:skills:install', input),
        remove: (skillId: string) => ipcRenderer.invoke('ai:skills:remove', skillId),
        enable: (skillId: string) => ipcRenderer.invoke('ai:skills:enable', skillId),
        disable: (skillId: string) => ipcRenderer.invoke('ai:skills:disable', skillId),
        preview: (input) => ipcRenderer.invoke('ai:skills:preview', input),
        resolve: (option) => ipcRenderer.invoke('ai:skills:resolve', option)
      },
      attachments: {
        upload: (input) => ipcRenderer.invoke('ai:attachments:upload', input),
        get: (attachmentId: string) => ipcRenderer.invoke('ai:attachments:get', attachmentId),
        delete: (attachmentId: string) => ipcRenderer.invoke('ai:attachments:delete', attachmentId),
        uploadToProvider: (input) => ipcRenderer.invoke('ai:attachments:upload-provider', input)
      },
      tokens: {
        estimate: (input) => ipcRenderer.invoke('ai:tokens:estimate', input)
      },
      images: {
        generate: (input) => ipcRenderer.invoke('ai:images:generate', input),
        generateStream: generateImageStream,
        edit: (input) => ipcRenderer.invoke('ai:images:edit', input)
      }
    }
    return api
  })()
}
