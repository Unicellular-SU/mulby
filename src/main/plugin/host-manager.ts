/**
 * Plugin Host Manager
 * 管理 UtilityProcess 插件宿主的生命周期
 */

import { utilityProcess, UtilityProcess, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { EventEmitter } from 'events'
import type {
  HostRequest,
  HostResponse,
  ApiResult
} from './host-protocol'
import { generateRequestId } from './host-protocol'
import { createPluginAPI } from './api'
import { PluginHostWatchdog } from './watchdog'
import type { InputAttachment, Plugin } from '../../shared/types/plugin'
import { loggerService } from '../services/logger'
import { resolveResourceLimits, applyResourceLimitsToWatchdog } from './resource-limits'
import { PLUGIN_READY_TIMEOUT_MS, PROCESS_GRACEFUL_EXIT_MS } from '../constants/timing'
import { PluginMessageBus } from './message-bus'
import type { TaskScheduler } from '../scheduler'
import type { ClipboardHistoryManager } from '../services/clipboard-history'
import log from 'electron-log'

// ============ 类型定义 ============

interface PluginHost {
  process: UtilityProcess
  pluginName: string
  runCommandAllowed: boolean
  ready: boolean
  activeRequests: number  // 活跃请求计数器
  startedAt: number       // 启动时间戳
  idleTimer: NodeJS.Timeout | null  // 空闲超时计时器
  idleTimeoutMs: number             // 空闲超时时长（0 = 永不销毁）
  cachedApi?: ReturnType<typeof createPluginAPI>  // 缓存 API 实例，避免每次请求重建
  pendingRequests: Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>
}

// ============ 常量 ============

const REQUEST_TIMEOUT = 300000  // 5 分钟请求超时（适配 AI 长调用）
/** 插件宿主进程默认空闲超时：5 分钟 */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000
const utf8FatalDecoder = new TextDecoder('utf-8', { fatal: true })
const gb18030Decoder = createGb18030Decoder()

function createGb18030Decoder(): TextDecoder | null {
  if (process.platform !== 'win32') return null
  try {
    return new TextDecoder('gb18030')
  } catch {
    return null
  }
}

function decodeHostOutput(chunk: Buffer): string {
  const utf8 = chunk.toString('utf8')
  if (!gb18030Decoder || isValidUtf8(chunk)) {
    return utf8
  }

  try {
    return gb18030Decoder.decode(chunk)
  } catch {
    return utf8
  }
}

function isValidUtf8(chunk: Buffer): boolean {
  try {
    utf8FatalDecoder.decode(chunk)
    return true
  } catch {
    return false
  }
}

interface PooledProcess {
  process: UtilityProcess
  readyAt: number
}

export class PluginHostManager extends EventEmitter {
  private hosts: Map<string, PluginHost> = new Map()
  private hostCreationPromises: Map<string, Promise<boolean>> = new Map()
  private workerPath: string
  private watchdog: PluginHostWatchdog
  private messageBus: PluginMessageBus
  private taskScheduler?: TaskScheduler
  private clipboardHistoryManager?: ClipboardHistoryManager
  /** 注入此回调以检查插件是否有活跃 UI 窗口（有则不销毁宿主进程） */
  hasActiveWindow?: (pluginId: string) => boolean

  private residentPins: Set<string> = new Set()

  // ==================== Host 进程池 ====================
  private static readonly MAX_POOL_SIZE = 1
  private pooledProcesses: PooledProcess[] = []
  private poolFilling = false
  private poolDestroyed = false
  private poolFillingChild: UtilityProcess | null = null

  constructor() {
    super()
    this.workerPath = this.resolveWorkerPath('host-worker.js')

    // 初始化 Watchdog
    this.watchdog = new PluginHostWatchdog()
    this.setupWatchdogListeners()
    this.watchdog.start()

    // Phase 4: 初始化消息总线
    this.messageBus = new PluginMessageBus()
  }

  /**
   * 解析 Worker 文件路径（兼容开发环境与 asar 打包环境）
   */
  private resolveWorkerPath(fileName: string): string {
    const candidates = [
      join(process.cwd(), 'dist', 'worker', fileName),
      join(app.getAppPath(), 'dist', 'worker', fileName),
      join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'worker', fileName),
      join(process.resourcesPath, 'app', 'dist', 'worker', fileName),
    ]

    const found = candidates.find((candidate) => existsSync(candidate))
    if (found) {
      log.info(`[HostManager] Worker resolved: ${found}`)
      return found
    }

    // asar 虚拟路径在部分场景 existsSync 可能返回 false，回退到 app.getAppPath 路径
    const fallback = join(app.getAppPath(), 'dist', 'worker', fileName)
    log.warn(`[HostManager] Worker path fallback: ${fallback}`)
    return fallback
  }

  /**
   * 设置任务调度器
   */
  setTaskScheduler(scheduler: TaskScheduler): void {
    this.taskScheduler = scheduler
  }

  /**
   * 设置剪贴板历史管理器
   */
  setClipboardHistoryManager(manager: ClipboardHistoryManager): void {
    this.clipboardHistoryManager = manager
  }

  // ==================== Resident UI Pin ====================

  setResidentPin(pluginId: string, pinned: boolean): void {
    if (pinned) {
      this.residentPins.add(pluginId)
    } else {
      this.residentPins.delete(pluginId)
    }
  }

  isResidentPinned(pluginId: string): boolean {
    return this.residentPins.has(pluginId)
  }

  // ==================== Host 进程池方法 ====================

  async fillPool(): Promise<void> {
    if (this.poolDestroyed || this.poolFilling || this.pooledProcesses.length >= PluginHostManager.MAX_POOL_SIZE) return
    this.poolFilling = true
    try {
      const child = utilityProcess.fork(this.workerPath, [], {
        serviceName: 'plugin-host-pool',
        stdio: 'pipe'
      })
      this.poolFillingChild = child

      child.on('exit', () => {
        if (this.poolFillingChild === child) this.poolFillingChild = null
        this.pooledProcesses = this.pooledProcesses.filter(p => p.process !== child)
      })

      const ready = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          try { child.kill() } catch { /* ignore */ }
          resolve(false)
        }, PLUGIN_READY_TIMEOUT_MS)

        const onMessage = (message: HostResponse) => {
          if (message?.type === 'ready') {
            clearTimeout(timer)
            child.removeListener('message', onMessage)
            resolve(true)
          }
        }
        child.on('message', onMessage)
      })

      this.poolFillingChild = null

      if (this.poolDestroyed) {
        try { child.kill() } catch { /* ignore */ }
        return
      }

      if (ready) {
        this.pooledProcesses.push({ process: child, readyAt: Date.now() })
        log.info(`[HostPool] idle process ready | pool size=${this.pooledProcesses.length}`)
      }
    } catch (err) {
      log.error('[HostPool] Failed to fill pool:', err)
    } finally {
      this.poolFilling = false
      this.poolFillingChild = null
    }
  }

  private acquirePooledProcess(): UtilityProcess | null {
    const entry = this.pooledProcesses.shift()
    if (!entry) return null
    log.info(`[HostPool] acquired pooled process | pool size=${this.pooledProcesses.length}`)
    void this.fillPool()
    return entry.process
  }

  destroyPool(): void {
    this.poolDestroyed = true
    for (const entry of this.pooledProcesses) {
      try { entry.process.kill() } catch { /* ignore */ }
    }
    this.pooledProcesses = []
    if (this.poolFillingChild) {
      try { this.poolFillingChild.kill() } catch { /* ignore */ }
      this.poolFillingChild = null
    }
  }

  /**
   * 设置 Watchdog 事件监听
   */
  private setupWatchdogListeners(): void {
    this.watchdog.on('host:unresponsive', (pluginName: string) => {
      log.warn(`[HostManager] Host unresponsive: ${pluginName}`)
      this.emit('host:error', pluginName, new Error('Host unresponsive'))
    })

    this.watchdog.on('host:memory-exceeded', (pluginName: string, memoryMB: number) => {
      log.warn(`[HostManager] Host memory exceeded: ${pluginName} (${memoryMB.toFixed(2)} MB)`)
    })

    this.watchdog.on('host:rate-limited', (pluginName: string, count: number) => {
      log.warn(`[HostManager] Host rate limited: ${pluginName} (${count} requests)`)
    })
  }

  /**
   * 为插件创建 Host 进程
   */
  async createHost(plugin: Plugin): Promise<boolean> {
    const pluginName = plugin.id
    const pendingCreation = this.hostCreationPromises.get(pluginName)
    if (pendingCreation) {
      return pendingCreation
    }

    const creationPromise = this.createHostInternal(plugin).finally(() => {
      if (this.hostCreationPromises.get(pluginName) === creationPromise) {
        this.hostCreationPromises.delete(pluginName)
      }
    })

    this.hostCreationPromises.set(pluginName, creationPromise)
    return creationPromise
  }

  private async createHostInternal(plugin: Plugin): Promise<boolean> {
    const pluginName = plugin.id
    const hostStart = Date.now()

    // 如果已存在，先销毁
    if (this.hosts.has(pluginName)) {
      await this.destroyHost(pluginName)
    }

    try {
      const pooled = this.acquirePooledProcess()
      let child: UtilityProcess
      let isPooled = false

      if (pooled) {
        child = pooled
        isPooled = true
        log.info(`[HostTrace] acquired from pool | plugin=${pluginName} | +${Date.now() - hostStart}ms`)
      } else {
        log.info(`[HostTrace] spawn start | plugin=${pluginName} | +${Date.now() - hostStart}ms`)
        child = utilityProcess.fork(this.workerPath, [], {
          serviceName: `plugin-host-${pluginName}`,
          stdio: 'pipe'
        })
        log.info(`[HostTrace] spawn done | plugin=${pluginName} | +${Date.now() - hostStart}ms`)
      }

      // 解析空闲超时配置
      const isBackgroundPlugin = plugin.manifest.pluginSetting?.background === true
      const idleTimeoutCfg = plugin.manifest.pluginSetting?.idleTimeoutMs
      const idleTimeoutMs = isBackgroundPlugin || idleTimeoutCfg === 'never' || idleTimeoutCfg === 0
        ? 0
        : typeof idleTimeoutCfg === 'number' && idleTimeoutCfg > 0
          ? idleTimeoutCfg
          : DEFAULT_IDLE_TIMEOUT_MS

      const host: PluginHost = {
        process: child,
        pluginName,
        runCommandAllowed: plugin.manifest.permissions?.runCommand === true,
        ready: isPooled,
        activeRequests: 0,
        startedAt: Date.now(),
        idleTimer: null,
        idleTimeoutMs,
        pendingRequests: new Map()
      }

      this.hosts.set(pluginName, host)
      this.setupHostListeners(host, plugin)

      const resourceLimitsConfig = plugin.manifest.pluginSetting?.resourceLimits
      const resolvedLimits = resolveResourceLimits(resourceLimitsConfig, 'medium')
      const customWatchdogConfig = applyResourceLimitsToWatchdog(resolvedLimits, {
        heartbeatInterval: 5000,
        heartbeatTimeout: 10000,
        maxMissedHeartbeats: 3,
        maxMemoryMB: 512,
        maxRequestsPerMinute: 1000,
        maxErrorsPerMinute: 50,
        memoryLeakThresholdMBPerMinute: 10,
        memoryHistorySize: 12
      })

      this.watchdog.registerHost(pluginName, customWatchdogConfig)

      if (isPooled) {
        log.info(`[HostTrace] pooled host ready | plugin=${pluginName} | +${Date.now() - hostStart}ms`)
        this.emit('host:ready', pluginName)
      } else {
        log.info(`[HostTrace] waitForReady start | plugin=${pluginName} | +${Date.now() - hostStart}ms`)
        const ready = await this.waitForReady(pluginName)
        log.info(`[HostTrace] waitForReady done | plugin=${pluginName} | ready=${ready} | +${Date.now() - hostStart}ms`)
        if (!ready) return false
      }
      return true
    } catch (err) {
      log.error(`Failed to create host for ${pluginName}:`, err)
      return false
    }
  }

  private async ensureHostReady(plugin: Plugin): Promise<boolean> {
    const pluginName = plugin.id
    let host = this.hosts.get(pluginName)

    if (!host) {
      const created = await this.createHost(plugin)
      if (!created) {
        return false
      }
      host = this.hosts.get(pluginName)
    }

    if (!host) {
      return false
    }

    if (!host.ready) {
      const ready = await this.waitForReady(pluginName)
      if (!ready) {
        log.error(`Host ready timeout: ${pluginName}`)
        return false
      }
    }

    return true
  }

  /**
   * 设置 Host 进程的事件监听
   */
  private setupHostListeners(host: PluginHost, plugin: Plugin): void {
    const { process: child, pluginName } = host

    // 监听消息
    child.on('message', (message: HostResponse) => {
      this.handleHostMessage(host, message, plugin)
    })

    // 监听退出
    child.on('exit', (code) => {
      log.info(`Plugin host ${pluginName} exited with code ${code}`)
      this.cleanupHost(pluginName)
      this.emit('host:exit', pluginName, code ?? 0)
    })

    // 监听标准输出（转发到日志系统）
    child.stdout?.on('data', (data: Buffer) => {
      const text = decodeHostOutput(data).trim()
      if (text) {
        log.info(`[${pluginName}] stdout:`, text)
        loggerService.write('info', pluginName, text)
      }
    })

    // 监听标准错误（转发到日志系统）
    child.stderr?.on('data', (data: Buffer) => {
      const text = decodeHostOutput(data).trim()
      if (text) {
        log.error(`[${pluginName}] stderr:`, text)
        loggerService.write('error', pluginName, text)
      }
    })
  }

  /**
   * 处理来自 Host 的消息
   */
  private handleHostMessage(host: PluginHost, message: HostResponse, plugin: Plugin): void {
    // 记录心跳
    this.watchdog.recordHeartbeat(host.pluginName)

    switch (message.type) {
      case 'ready':
        host.ready = true
        this.emit('host:ready', host.pluginName)
        break

      case 'result':
      case 'error':
        this.handleRequestResponse(host, message)
        break

      case 'apiCall':
        this.handleApiCall(host, message, plugin)
        break

      case 'resourceStats':
        this.handleResourceStats(host, message)
        break
    }
  }

  /**
   * 处理资源统计
   */
  private handleResourceStats(host: PluginHost, message: HostResponse): void {
    if (message.type !== 'resourceStats') return

    const { memoryUsage, cpuUsage } = message.payload

    // 更新内存使用（使用 RSS - 常驻集大小）
    this.watchdog.updateMemoryUsage(host.pluginName, memoryUsage.rss)

    // 更新 CPU 使用（user + system 时间）
    const totalCpuTime = cpuUsage.user + cpuUsage.system
    this.watchdog.updateCpuUsage(host.pluginName, totalCpuTime)
  }

  /**
   * 处理请求响应
   */
  private handleRequestResponse(host: PluginHost, message: HostResponse): void {
    const pending = host.pendingRequests.get(message.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    host.pendingRequests.delete(message.id)

    if (message.type === 'error') {
      pending.reject(new Error(message.payload.message))
    } else {
      pending.resolve(message.payload)
    }
  }

  /**
   * 处理 API 调用请求
   */
  private async handleApiCall(
    host: PluginHost,
    message: HostResponse & { type: 'apiCall' },
    plugin: Plugin
  ): Promise<void> {
    const { api, args } = message.payload
    const [namespace, method] = api.split('.')

    try {
      // 缓存 pluginAPI 实例，避免每次 API 调用都重新创建
      if (!host.cachedApi) {
        host.cachedApi = createPluginAPI(
          plugin.id,
          this.messageBus,
          this.taskScheduler,
          this.clipboardHistoryManager,
          { runCommandAllowed: host.runCommandAllowed }
        )
      }
      const pluginApi = host.cachedApi
      const apiNamespace = pluginApi[namespace as keyof typeof pluginApi]

      if (!apiNamespace || typeof apiNamespace !== 'object') {
        throw new Error(`Unknown API namespace: ${namespace}`)
      }

      const apiMethod = (apiNamespace as Record<string, unknown>)[method]
      if (typeof apiMethod !== 'function') {
        throw new Error(`Unknown API method: ${api}`)
      }

      const result = await apiMethod(...args)

      // 发送结果回 Worker
      const response: ApiResult = {
        id: message.id,
        success: true,
        data: result
      }
      host.process.postMessage(response)
    } catch (err) {
      const response: ApiResult = {
        id: message.id,
        success: false,
        error: err instanceof Error ? err.message : 'API call failed'
      }
      host.process.postMessage(response)
    }
  }

  /**
   * 启动内存监控
   */
  /**
   * 等待 Host 就绪
   */
  private waitForReady(pluginName: string, timeout = PLUGIN_READY_TIMEOUT_MS): Promise<boolean> {
    return new Promise((resolve) => {
      const host = this.hosts.get(pluginName)
      if (!host) {
        resolve(false)
        return
      }

      if (host.ready) {
        resolve(true)
        return
      }

      const onReady = (name: string) => {
        if (name === pluginName) {
          clearTimeout(timer)
          this.off('host:ready', onReady)
          resolve(true)
        }
      }

      const timer = setTimeout(() => {
        this.off('host:ready', onReady)
        resolve(false)
      }, timeout)

      this.on('host:ready', onReady)
    })
  }

  /**
   * 发送请求到 Host
   */
  private sendRequest<T>(pluginName: string, request: HostRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      const host = this.hosts.get(pluginName)
      if (!host) {
        reject(new Error(`Host not found: ${pluginName}`))
        return
      }

      if (!host.ready) {
        reject(new Error(`Host not ready: ${pluginName}`))
        return
      }

      // 请求开始：取消 idle timer，保证进程不在请求期间被销毁
      this.cancelIdleCleanup(pluginName)
      host.activeRequests++

      const cleanup = () => {
        host.activeRequests--
        // 请求结束：若队列已空，调度空闲超时销毁
        if (host.activeRequests === 0) {
          this.scheduleIdleCleanup(pluginName)
        }
      }

      const timeout = setTimeout(() => {
        host.pendingRequests.delete(request.id)
        cleanup()
        reject(new Error(`Request timeout: ${request.type}`))
      }, REQUEST_TIMEOUT)

      host.pendingRequests.set(request.id, {
        resolve: (value: unknown) => {
          cleanup()
          resolve(value as T)
        },
        reject: (error: Error) => {
          cleanup()
          reject(error)
        },
        timeout
      })

      host.process.postMessage(request)
    })
  }

  // ==================== 空闲超时销毁 ====================

  /**
   * 调度空闲超时销毁
   * - 只在 activeRequests === 0 且无活跃 UI 窗口时销毁
   * - 使用 .unref() 保证 timer 不会阻止 Electron 进程退出
   */
  private scheduleIdleCleanup(pluginName: string): void {
    const host = this.hosts.get(pluginName)
    if (!host || host.idleTimeoutMs === 0) return  // 永不销毁
    if (host.idleTimer) return  // 已有 timer，避免重复调度

    host.idleTimer = setTimeout(async () => {
      const h = this.hosts.get(pluginName)
      if (!h) return
      h.idleTimer = null

      // 双重保险：timer 触发时已有新请求进来
      if (h.activeRequests > 0) return

      // UI 窗口保护：有活跃窗口则推迟销毁（等待窗口关闭）
      if (this.hasActiveWindow?.(pluginName)) {
        this.scheduleIdleCleanup(pluginName)
        return
      }

      // Resident UI 保护：隐藏的 UI 缓存仍需保留 Host
      if (this.residentPins.has(pluginName)) {
        this.scheduleIdleCleanup(pluginName)
        return
      }

      console.info(`[HostManager] Idle timeout → destroying host: ${pluginName}`)
      await this.destroyHost(pluginName)
    }, host.idleTimeoutMs).unref()
  }

  /** 取消空闲超时计时器 */
  private cancelIdleCleanup(pluginName: string): void {
    const host = this.hosts.get(pluginName)
    if (!host?.idleTimer) return
    clearTimeout(host.idleTimer)
    host.idleTimer = null
  }

  /**
   * 初始化插件
   */
  async initPlugin(plugin: Plugin): Promise<boolean> {
    const pluginName = plugin.id
    const initStart = Date.now()
    log.info(`[HostTrace] initPlugin start | plugin=${pluginName}`)

    const hostReady = await this.ensureHostReady(plugin)
    if (!hostReady) return false
    log.info(`[HostTrace] ensureHostReady done | plugin=${pluginName} | +${Date.now() - initStart}ms`)

    try {
      await this.sendRequest(pluginName, {
        id: generateRequestId(),
        type: 'init',
        payload: {
          pluginName: plugin.id,
          pluginPath: plugin.path,
          mainFile: plugin.manifest.main
        }
      })
      log.info(`[HostTrace] initPlugin done (entry registered) | plugin=${pluginName} | +${Date.now() - initStart}ms`)
      return true
    } catch (err) {
      log.error(`Failed to init plugin ${pluginName}:`, err)
      return false
    }
  }

  /**
   * 执行插件
   */
  async runPlugin(
    plugin: Plugin,
    featureCode: string,
    input: string,
    attachments?: InputAttachment[]
  ): Promise<void> {
    const pluginName = plugin.id

    const inited = await this.initPlugin(plugin)
    if (!inited) {
      throw new Error(`Failed to init plugin: ${pluginName}`)
    }

    await this.sendRequest(pluginName, {
      id: generateRequestId(),
      type: 'run',
      payload: { featureCode, input, attachments }
    })
  }

  /**
   * 调用生命周期钩子
   */
  async callHook(
    plugin: Plugin,
    hookName: 'onLoad' | 'onIdleLoad' | 'onUnload' | 'onEnable' | 'onDisable' | 'onBackground' | 'onForeground'
  ): Promise<void> {
    const pluginName = plugin.id
    const hookStart = Date.now()
    log.info(`[HostTrace] callHook(${hookName}) start | plugin=${pluginName}`)

    const inited = await this.initPlugin(plugin)
    if (!inited) {
      throw new Error(`Failed to init plugin: ${pluginName}`)
    }
    log.info(`[HostTrace] callHook(${hookName}) initPlugin done | plugin=${pluginName} | +${Date.now() - hookStart}ms`)

    await this.sendRequest(pluginName, {
      id: generateRequestId(),
      type: 'callHook',
      payload: { hookName }
    })
    log.info(`[HostTrace] callHook(${hookName}) done | plugin=${pluginName} | +${Date.now() - hookStart}ms`)
  }

  /**
   * 调用任务回调
   */
  async callTaskCallback(
    plugin: Plugin,
    callbackName: string,
    payload: unknown,
    task: unknown
  ): Promise<unknown> {
    const pluginName = plugin.id

    const inited = await this.initPlugin(plugin)
    if (!inited) {
      throw new Error(`Failed to init plugin: ${pluginName}`)
    }

    return await this.sendRequest(pluginName, {
      id: generateRequestId(),
      type: 'callTaskCallback',
      payload: { callbackName, payload, task }
    })
  }

  /**
   * 销毁 Host 进程
   */
  async destroyHost(pluginName: string): Promise<void> {
    const host = this.hosts.get(pluginName)
    if (!host) return

    try {
      // 发送终止请求
      host.process.postMessage({
        id: generateRequestId(),
        type: 'terminate',
        payload: null
      })

      // 等待一小段时间让进程优雅退出
      await new Promise(resolve => setTimeout(resolve, PROCESS_GRACEFUL_EXIT_MS))

      // 强制终止
      if (host.process.pid) {
        host.process.kill()
      }
    } catch (err) {
      log.error(`Error destroying host ${pluginName}:`, err)
    }

    this.cleanupHost(pluginName)
  }

  /**
   * 清理 Host 资源
   */
  private cleanupHost(pluginName: string): void {
    const host = this.hosts.get(pluginName)
    if (!host) return

    this.residentPins.delete(pluginName)

    // 清理 idle timer（防止 host 销毁后 timer 仍悬挂触发）
    if (host.idleTimer) {
      clearTimeout(host.idleTimer)
      host.idleTimer = null
    }

    // 注销 Watchdog 监控
    this.watchdog.unregisterHost(pluginName)

    // Phase 4: 清理消息总线订阅
    this.messageBus.cleanup(pluginName)

    // 清理所有待处理的请求
    for (const [, pending] of host.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Host destroyed'))
    }

    this.hosts.delete(pluginName)
  }

  /**
   * 销毁所有 Host
   */
  async destroyAll(): Promise<void> {
    // 停止 Watchdog
    this.watchdog.stop()

    const names = Array.from(this.hosts.keys())
    await Promise.all(names.map(name => this.destroyHost(name)))
  }

  /**
   * 检查 Host 是否存在且就绪
   */
  isHostReady(pluginName: string): boolean {
    const host = this.hosts.get(pluginName)
    return host?.ready ?? false
  }

  /**
   * 获取所有活跃的 Host 名称
   */
  getActiveHosts(): string[] {
    return Array.from(this.hosts.keys())
  }

  /**
   * 获取 Host 信息
   */
  getHostInfo(pluginName: string): { startedAt: number } | null {
    const host = this.hosts.get(pluginName)
    if (!host) return null
    return { startedAt: host.startedAt }
  }

  /**
   * 获取 Watchdog 实例
   */
  getWatchdog(): PluginHostWatchdog {
    return this.watchdog
  }

  /**
   * Phase 4: 获取消息总线实例
   */
  getMessageBus(): PluginMessageBus {
    return this.messageBus
  }

  /**
   * 调用插件方法（供 UI 窗口使用）
   * @param pluginName 插件名称
   * @param method API 方法路径，如 'clipboard.readText'
   * @param args 参数列表
   */
  async invokePluginMethod(
    pluginName: string,
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    const host = this.hosts.get(pluginName)
    if (!host || !host.ready) {
      throw new Error(`Host not ready: ${pluginName}`)
    }

    // 直接调用主进程的 API（因为 API 实现在主进程中）
    const [namespace, methodName] = method.split('.')
    // 缓存 pluginAPI 实例，避免每次调用都重新创建
    if (!host.cachedApi) {
      host.cachedApi = createPluginAPI(
        pluginName,
        this.messageBus,
        this.taskScheduler,
        this.clipboardHistoryManager,
        { runCommandAllowed: host.runCommandAllowed }
      )
    }
    const pluginApi = host.cachedApi
    const apiNamespace = pluginApi[namespace as keyof typeof pluginApi]

    if (!apiNamespace || typeof apiNamespace !== 'object') {
      throw new Error(`Unknown API namespace: ${namespace}. If you meant to call a plugin backend method, use host.call('${pluginName}', '${methodName || method}', ...args) instead of host.invoke().`)
    }

    const apiMethod = (apiNamespace as Record<string, unknown>)[methodName]
    if (typeof apiMethod !== 'function') {
      throw new Error(`Unknown API method: ${method}. If you meant to call a plugin backend method, use host.call('${pluginName}', '${methodName}', ...args) instead of host.invoke().`)
    }

    return await apiMethod(...args)
  }

  /**
   * 调用插件 host 方法（供 UI 窗口使用）
   * @param pluginName 插件名称
   * @param method host 方法名，如 'getTasks'
   * @param args 参数列表
   */
  async callHostMethod(
    pluginName: string,
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    const host = this.hosts.get(pluginName)
    if (!host || !host.ready) {
      throw new Error(`Host not ready: ${pluginName}`)
    }

    return await this.sendRequest(pluginName, {
      id: generateRequestId(),
      type: 'callHostMethod',
      payload: { method, args }
    })
  }
}
