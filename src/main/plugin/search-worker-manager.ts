import { app, utilityProcess, UtilityProcess } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { InputPayload } from '../../shared/types/plugin'
import type { SearchPluginData, SearchRequest, SearchResponse, SearchResultRef, SyncRequest } from './search-protocol'
import log from 'electron-log'

interface PendingRequest {
  resolve: (value: unknown) => void
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
  // 方案A: 缓存最新的插件数据，用于增量同步和 Worker 重启后恢复
  private lastSyncedPlugins: SearchPluginData[] | null = null
  private synced = false

  constructor() {
    this.workerPath = this.resolveWorkerPath('search-worker.js')
  }

  // 方案A: 同步插件数据到 Worker（仅在插件列表变更时调用）
  async syncPlugins(plugins: SearchPluginData[]): Promise<void> {
    this.lastSyncedPlugins = plugins
    // P1 修复: 立即标记未同步，确保并发搜索等待同步完成而非使用旧快照
    this.synced = false
    this.ensureWorker()
    await this.waitUntilReady(WARMUP_READY_WAIT_TIMEOUT)

    const requestId = this.generateId()
    const request: SyncRequest = {
      id: requestId,
      type: 'sync',
      payload: { plugins }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(requestId)
        if (!pending) return
        this.pending.delete(requestId)
        pending.reject(new Error('Sync request timeout'))
      }, REQUEST_TIMEOUT)

      this.pending.set(requestId, { resolve: () => { this.synced = true; resolve() }, reject, timeout })
      this.worker?.postMessage(request)
    })
  }

  // 方案A: search 不再传入 plugins，使用已同步的快照
  async search(input: InputPayload): Promise<SearchResultRef[]> {
    this.ensureWorker()
    await this.waitUntilReady(SEARCH_READY_WAIT_TIMEOUT)

    // 如果 Worker 尚未同步过插件数据，先同步
    if (!this.synced && this.lastSyncedPlugins) {
      await this.syncPlugins(this.lastSyncedPlugins)
    }

    // P2: 取消所有之前未完成的搜索请求，避免过时结果无谓等待
    for (const [pendingId, pending] of this.pending) {
      if (pendingId.startsWith('search:')) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('Search request superseded'))
        this.pending.delete(pendingId)
      }
    }

    const requestId = `search:${this.generateId()}`
    const request: SearchRequest = {
      id: requestId,
      type: 'search',
      payload: { input }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(requestId)
        if (!pending) return
        this.pending.delete(requestId)
        pending.reject(new Error('Search request timeout'))
        this.restartWorker('request-timeout')
      }, REQUEST_TIMEOUT)

      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timeout })
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
    log.warn(`[SearchWorker] Restarted due to ${reason}`)
    // Worker 重启后标记未同步，下次搜索时会自动重新同步
    this.synced = false
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
      log.info('[SearchWorker]', chunk.toString())
    })
    this.worker.stderr?.on('data', (chunk) => {
      log.error('[SearchWorker]', chunk.toString())
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
      if (payload.type === 'sync-ack') {
        // sync-ack 回复：resolve void
        pending.resolve(undefined)
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
      // P2b 修复: Worker 退出后标记未同步，下次搜索会先重新同步
      this.synced = false
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
      log.info(`[SearchWorker] Worker resolved: ${found}`)
      return found
    }

    const fallback = join(app.getAppPath(), 'dist', 'worker', fileName)
    log.warn(`[SearchWorker] Worker path fallback: ${fallback}`)
    return fallback
  }
}
