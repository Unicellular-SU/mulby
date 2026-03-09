import { app, utilityProcess, UtilityProcess } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { InputPayload } from '../../shared/types/plugin'
import type { SearchPluginData, SearchRequest, SearchResponse, SearchResultRef } from './search-protocol'

interface PendingRequest {
  resolve: (value: SearchResultRef[]) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

const REQUEST_TIMEOUT = 2000
const SEARCH_READY_WAIT_TIMEOUT = 1200
const WARMUP_READY_WAIT_TIMEOUT = 5000
const WORKER_READY_HARD_TIMEOUT = 10000

export class PluginSearchWorker {
  private worker: UtilityProcess | null = null
  private pending: Map<string, PendingRequest> = new Map()
  private workerPath: string
  private ready = false
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private readyTimeout: NodeJS.Timeout | null = null

  constructor() {
    this.workerPath = this.resolveWorkerPath('search-worker.js')
  }

  async search(input: InputPayload, plugins: SearchPluginData[]): Promise<SearchResultRef[]> {
    this.ensureWorker()
    await this.waitUntilReady(SEARCH_READY_WAIT_TIMEOUT)

    const requestId = this.generateId()
    const request: SearchRequest = {
      id: requestId,
      type: 'search',
      payload: { input, plugins }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(requestId)
        if (!pending) return
        this.pending.delete(requestId)
        pending.reject(new Error('Search request timeout'))
        this.restartWorker('request-timeout')
      }, REQUEST_TIMEOUT)

      this.pending.set(requestId, { resolve, reject, timeout })
      this.worker?.postMessage(request)
    })
  }

  async warmup(): Promise<void> {
    this.ensureWorker()
    await this.waitUntilReady(WARMUP_READY_WAIT_TIMEOUT)
  }

  async destroy(): Promise<void> {
    const error = new Error('Search worker destroyed')
    this.rejectReady?.(error)
    this.rejectAllPending(error)

    const current = this.worker
    this.worker = null
    this.clearReadyState()

    if (!current) return
    try {
      current.kill()
    } catch {
      // ignore
    }
  }

  private waitUntilReady(timeoutMs: number): Promise<void> {
    this.ensureWorker()
    if (this.ready) {
      return Promise.resolve()
    }
    const readyPromise = this.readyPromise
    if (!readyPromise) {
      return Promise.reject(new Error('Search worker is not initialized'))
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Search worker ready timeout (${timeoutMs}ms)`))
      }, timeoutMs)

      readyPromise.then(() => {
        clearTimeout(timer)
        resolve()
      }, (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  private clearReadyState(): void {
    this.ready = false
    this.readyPromise = null
    this.resolveReady = null
    this.rejectReady = null
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout)
      this.readyTimeout = null
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(requestId)
    }
  }

  private restartWorker(reason: string): void {
    if (!this.worker) return
    const current = this.worker
    this.worker = null
    this.clearReadyState()
    try {
      current.kill()
    } catch {
      // ignore
    }
    console.warn(`[SearchWorker] Restarted due to ${reason}`)
  }

  private ensureWorker(): void {
    if (this.worker) return

    this.worker = utilityProcess.fork(this.workerPath)
    this.ready = false
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.readyTimeout = setTimeout(() => {
      if (this.ready) return
      const error = new Error(`Search worker hard ready timeout (${WORKER_READY_HARD_TIMEOUT}ms)`)
      this.rejectReady?.(error)
      this.rejectAllPending(error)
      this.restartWorker('hard-ready-timeout')
    }, WORKER_READY_HARD_TIMEOUT)

    this.worker.stdout?.on('data', (chunk) => {
      console.log('[SearchWorker]', chunk.toString())
    })
    this.worker.stderr?.on('data', (chunk) => {
      console.error('[SearchWorker]', chunk.toString())
    })
    this.worker.on('message', (message: unknown) => {
      const payload = (
        typeof message === 'object' && message !== null && 'data' in message
          ? (message as { data?: unknown }).data
          : message
      ) as SearchResponse
      if (!payload || !payload.id) return
      if (payload.type === 'ready') {
        this.ready = true
        if (this.readyTimeout) {
          clearTimeout(this.readyTimeout)
          this.readyTimeout = null
        }
        this.resolveReady?.()
        this.resolveReady = null
        this.rejectReady = null
        return
      }
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

    this.worker.on('exit', (code: number) => {
      const reason = `Search worker exited (code=${code})`
      const error = new Error(reason)
      this.rejectReady?.(error)
      this.rejectAllPending(error)
      this.clearReadyState()
      this.worker = null
    })
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }

  private resolveWorkerPath(fileName: string): string {
    const candidates = [
      join(process.cwd(), 'dist', 'worker', fileName),
      join(app.getAppPath(), 'dist', 'worker', fileName),
      join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'worker', fileName),
      join(process.resourcesPath, 'app', 'dist', 'worker', fileName),
    ]

    const found = candidates.find((candidate) => existsSync(candidate))
    if (found) {
      console.log(`[SearchWorker] Worker resolved: ${found}`)
      return found
    }

    const fallback = join(app.getAppPath(), 'dist', 'worker', fileName)
    console.warn(`[SearchWorker] Worker path fallback: ${fallback}`)
    return fallback
  }
}
