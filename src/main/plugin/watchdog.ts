/**
 * Plugin Host Watchdog
 * 监控 UtilityProcess 的健康状态，检测无响应和资源滥用
 */

import { EventEmitter } from 'events'

// ============ 类型定义 ============

interface HostHealth {
  pluginName: string
  lastHeartbeat: number
  missedHeartbeats: number
  memoryUsage: number
  cpuUsage: number
  requestCount: number
  errorCount: number
}

interface WatchdogConfig {
  heartbeatInterval: number    // 心跳检测间隔（毫秒）
  heartbeatTimeout: number     // 心跳超时时间（毫秒）
  maxMissedHeartbeats: number  // 最大允许丢失心跳次数
  maxMemoryMB: number          // 最大内存使用（MB）
  maxRequestsPerMinute: number // 每分钟最大请求数
  maxErrorsPerMinute: number   // 每分钟最大错误数
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: WatchdogConfig = {
  heartbeatInterval: 5000,      // 5 秒
  heartbeatTimeout: 10000,      // 10 秒
  maxMissedHeartbeats: 3,       // 3 次
  maxMemoryMB: 512,             // 512 MB
  maxRequestsPerMinute: 1000,   // 1000 次/分钟
  maxErrorsPerMinute: 50        // 50 次/分钟
}

export class PluginHostWatchdog extends EventEmitter {
  private config: WatchdogConfig
  private hosts: Map<string, HostHealth> = new Map()
  private checkInterval: NodeJS.Timeout | null = null
  private running = false

  constructor(config: Partial<WatchdogConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 启动 Watchdog
   */
  start(): void {
    if (this.running) return

    this.running = true
    this.checkInterval = setInterval(() => {
      this.checkAllHosts()
    }, this.config.heartbeatInterval)

    console.log('[Watchdog] Started with config:', this.config)
  }

  /**
   * 停止 Watchdog
   */
  stop(): void {
    if (!this.running) return

    this.running = false
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }

    console.log('[Watchdog] Stopped')
  }

  /**
   * 注册 Host 监控
   */
  registerHost(pluginName: string): void {
    this.hosts.set(pluginName, {
      pluginName,
      lastHeartbeat: Date.now(),
      missedHeartbeats: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      requestCount: 0,
      errorCount: 0
    })
  }

  /**
   * 注销 Host 监控
   */
  unregisterHost(pluginName: string): void {
    this.hosts.delete(pluginName)
  }

  /**
   * 记录心跳
   */
  recordHeartbeat(pluginName: string): void {
    const health = this.hosts.get(pluginName)
    if (!health) return

    const wasUnresponsive = health.missedHeartbeats >= this.config.maxMissedHeartbeats

    health.lastHeartbeat = Date.now()
    health.missedHeartbeats = 0

    if (wasUnresponsive) {
      this.emit('host:recovered', pluginName)
    }
  }

  /**
   * 记录请求
   */
  recordRequest(pluginName: string): boolean {
    const health = this.hosts.get(pluginName)
    if (!health) return true

    health.requestCount++

    // 检查速率限制
    if (health.requestCount > this.config.maxRequestsPerMinute) {
      this.emit('host:rate-limited', pluginName, health.requestCount)
      return false
    }

    return true
  }

  /**
   * 记录错误
   */
  recordError(pluginName: string): void {
    const health = this.hosts.get(pluginName)
    if (!health) return

    health.errorCount++

    if (health.errorCount >= this.config.maxErrorsPerMinute) {
      this.emit('host:error-threshold', pluginName, health.errorCount)
    }
  }

  /**
   * 更新内存使用
   */
  updateMemoryUsage(pluginName: string, memoryBytes: number): void {
    const health = this.hosts.get(pluginName)
    if (!health) return

    const memoryMB = memoryBytes / (1024 * 1024)
    health.memoryUsage = memoryMB

    if (memoryMB > this.config.maxMemoryMB) {
      this.emit('host:memory-exceeded', pluginName, memoryMB)
    }
  }

  /**
   * 获取 Host 健康状态
   */
  getHostHealth(pluginName: string): HostHealth | undefined {
    return this.hosts.get(pluginName)
  }

  /**
   * 获取所有 Host 健康状态
   */
  getAllHostHealth(): HostHealth[] {
    return Array.from(this.hosts.values())
  }

  /**
   * 检查所有 Host 的健康状态
   */
  private checkAllHosts(): void {
    const now = Date.now()

    for (const [pluginName, health] of this.hosts) {
      // 检查心跳
      const timeSinceLastHeartbeat = now - health.lastHeartbeat
      if (timeSinceLastHeartbeat > this.config.heartbeatTimeout) {
        health.missedHeartbeats++

        if (health.missedHeartbeats >= this.config.maxMissedHeartbeats) {
          this.emit('host:unresponsive', pluginName)
        }
      }

      // 重置每分钟计数器（简化实现，每次检查时衰减）
      health.requestCount = Math.floor(health.requestCount * 0.8)
      health.errorCount = Math.floor(health.errorCount * 0.8)
    }
  }

  /**
   * 检查 Host 是否健康
   */
  isHostHealthy(pluginName: string): boolean {
    const health = this.hosts.get(pluginName)
    if (!health) return false

    return (
      health.missedHeartbeats < this.config.maxMissedHeartbeats &&
      health.memoryUsage < this.config.maxMemoryMB &&
      health.errorCount < this.config.maxErrorsPerMinute
    )
  }
}
