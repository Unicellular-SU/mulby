import { app, utilityProcess, UtilityProcess } from 'electron'
import { join } from 'path'
import type { InputPayload } from '../../shared/types/plugin'
import type { SearchPluginData, SearchRequest, SearchResponse, SearchResultRef } from './search-protocol'

interface PendingRequest {
  resolve: (value: SearchResultRef[]) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

const REQUEST_TIMEOUT = 15000

export class PluginSearchWorker {
  private worker: UtilityProcess | null = null
  private pending: Map<string, PendingRequest> = new Map()
  private workerPath: string

  constructor() {
    this.workerPath = app.isPackaged
      ? join(process.resourcesPath, 'app', 'dist', 'worker', 'search-worker.js')
      : join(process.cwd(), 'dist', 'worker', 'search-worker.js')
  }

  async search(input: InputPayload, plugins: SearchPluginData[]): Promise<SearchResultRef[]> {
    this.ensureWorker()

    const requestId = this.generateId()
    const request: SearchRequest = {
      id: requestId,
      type: 'search',
      payload: { input, plugins }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Search request timeout'))
      }, REQUEST_TIMEOUT)

      this.pending.set(requestId, { resolve, reject, timeout })
      this.worker?.postMessage(request)
    })
  }

  private ensureWorker(): void {
    if (this.worker && !this.worker.killed) return

    this.worker = utilityProcess.fork(this.workerPath)
    this.worker.stdout?.on('data', (chunk) => {
      console.log('[SearchWorker]', chunk.toString())
    })
    this.worker.stderr?.on('data', (chunk) => {
      console.error('[SearchWorker]', chunk.toString())
    })
    this.worker.on('message', (message: SearchResponse | { data?: SearchResponse }) => {
      const payload = message && 'data' in message ? message.data : message
      if (!payload || !payload.id) return
      const pending = this.pending.get(payload.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(payload.id)

      if (payload.type === 'error') {
        pending.reject(new Error(payload.payload.message))
        return
      }
      pending.resolve(payload.payload.results)
    })

    this.worker.on('error', (error) => {
      console.error('[SearchWorker] UtilityProcess error:', error)
    })

    this.worker.on('exit', () => {
      this.worker = null
    })
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }
}
