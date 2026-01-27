/**
 * Plugin Host Manager
 * 管理 UtilityProcess 插件宿主的生命周期
 */

import { utilityProcess, UtilityProcess, app } from 'electron'
import { join } from 'path'
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

// ============ 类型定义 ============

interface PluginHost {
  process: UtilityProcess
  pluginName: string
  ready: boolean
  activeRequests: number  // 活跃请求计数器
  pendingRequests: Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>
}

// ============ 常量 ============

const REQUEST_TIMEOUT = 30000  // 30 秒请求超时

export class PluginHostManager extends EventEmitter {
  private hosts: Map<string, PluginHost> = new Map()
  private workerPath: string
  private watchdog: PluginHostWatchdog

  constructor() {
    super()
    // Worker 文件路径（编译后）
    this.workerPath = app.isPackaged
      ? join(process.resourcesPath, 'app', 'dist', 'worker', 'host-worker.js')
      : join(process.cwd(), 'dist', 'worker', 'host-worker.js')

    // 初始化 Watchdog
    this.watchdog = new PluginHostWatchdog()
    this.setupWatchdogListeners()
    this.watchdog.start()
  }

  /**
   * 设置 Watchdog 事件监听
   */
  private setupWatchdogListeners(): void {
    this.watchdog.on('host:unresponsive', (pluginName: string) => {
      console.warn(`[HostManager] Host unresponsive: ${pluginName}`)
      this.emit('host:error', pluginName, new Error('Host unresponsive'))
    })

    this.watchdog.on('host:memory-exceeded', (pluginName: string, memoryMB: number) => {
      console.warn(`[HostManager] Host memory exceeded: ${pluginName} (${memoryMB.toFixed(2)} MB)`)
    })

    this.watchdog.on('host:rate-limited', (pluginName: string, count: number) => {
      console.warn(`[HostManager] Host rate limited: ${pluginName} (${count} requests)`)
    })
  }

  /**
   * 为插件创建 Host 进程
   */
  async createHost(plugin: Plugin): Promise<boolean> {
    const pluginName = plugin.id

    // 如果已存在，先销毁
    if (this.hosts.has(pluginName)) {
      await this.destroyHost(pluginName)
    }

    try {
      const child = utilityProcess.fork(this.workerPath, [], {
        serviceName: `plugin-host-${pluginName}`,
        stdio: 'pipe'
      })

      const host: PluginHost = {
        process: child,
        pluginName,
        ready: false,
        activeRequests: 0,
        pendingRequests: new Map()
      }

      this.hosts.set(pluginName, host)
      this.setupHostListeners(host, plugin)

      // 注意：不在这里注册 Watchdog，而是在执行请求时注册
      // 这样只有在插件活跃执行期间才会检测心跳

      // 等待 ready 信号
      return await this.waitForReady(pluginName)
    } catch (err) {
      console.error(`Failed to create host for ${pluginName}:`, err)
      return false
    }
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
      console.log(`Plugin host ${pluginName} exited with code ${code}`)
      this.cleanupHost(pluginName)
      this.emit('host:exit', pluginName, code ?? 0)
    })

    // 监听标准输出（调试用）
    child.stdout?.on('data', (data) => {
      console.log(`[${pluginName}] stdout:`, data.toString())
    })

    // 监听标准错误
    child.stderr?.on('data', (data) => {
      console.error(`[${pluginName}] stderr:`, data.toString())
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
    }
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
      const pluginApi = createPluginAPI(plugin.id)
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
   * 等待 Host 就绪
   */
  private waitForReady(pluginName: string, timeout = 10000): Promise<boolean> {
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

      const timer = setTimeout(() => {
        resolve(false)
      }, timeout)

      const onReady = (name: string) => {
        if (name === pluginName) {
          clearTimeout(timer)
          this.off('host:ready', onReady)
          resolve(true)
        }
      }

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

      // 增加活跃请求计数，首次时注册 Watchdog
      if (host.activeRequests === 0) {
        this.watchdog.registerHost(pluginName)
      }
      host.activeRequests++

      const cleanup = () => {
        host.activeRequests--
        // 没有活跃请求时注销 Watchdog
        if (host.activeRequests === 0) {
          this.watchdog.unregisterHost(pluginName)
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

  /**
   * 初始化插件
   */
  async initPlugin(plugin: Plugin): Promise<boolean> {
    const pluginName = plugin.id

    // 确保 Host 存在
    let host = this.hosts.get(pluginName)
    if (!host) {
      const created = await this.createHost(plugin)
      if (!created) return false
      host = this.hosts.get(pluginName)
    }

    if (!host) return false

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
      return true
    } catch (err) {
      console.error(`Failed to init plugin ${pluginName}:`, err)
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

    // 确保插件已初始化
    if (!this.hosts.has(pluginName)) {
      const inited = await this.initPlugin(plugin)
      if (!inited) {
        throw new Error(`Failed to init plugin: ${pluginName}`)
      }
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
    hookName: 'onLoad' | 'onUnload' | 'onEnable' | 'onDisable' | 'onBackground' | 'onForeground'
  ): Promise<void> {
    const pluginName = plugin.id

    // 确保插件已初始化
    if (!this.hosts.has(pluginName)) {
      const inited = await this.initPlugin(plugin)
      if (!inited) {
        throw new Error(`Failed to init plugin: ${pluginName}`)
      }
    }

    await this.sendRequest(pluginName, {
      id: generateRequestId(),
      type: 'callHook',
      payload: { hookName }
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
      await new Promise(resolve => setTimeout(resolve, 100))

      // 强制终止
      if (host.process.pid) {
        host.process.kill()
      }
    } catch (err) {
      console.error(`Error destroying host ${pluginName}:`, err)
    }

    this.cleanupHost(pluginName)
  }

  /**
   * 清理 Host 资源
   */
  private cleanupHost(pluginName: string): void {
    const host = this.hosts.get(pluginName)
    if (!host) return

    // 注销 Watchdog 监控
    this.watchdog.unregisterHost(pluginName)

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
   * 获取 Watchdog 实例
   */
  getWatchdog(): PluginHostWatchdog {
    return this.watchdog
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
    const pluginApi = createPluginAPI(pluginName)
    const apiNamespace = pluginApi[namespace as keyof typeof pluginApi]

    if (!apiNamespace || typeof apiNamespace !== 'object') {
      throw new Error(`Unknown API namespace: ${namespace}`)
    }

    const apiMethod = (apiNamespace as Record<string, unknown>)[methodName]
    if (typeof apiMethod !== 'function') {
      throw new Error(`Unknown API method: ${method}`)
    }

    return await apiMethod(...args)
  }
}
