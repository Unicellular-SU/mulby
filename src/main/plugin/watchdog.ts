/**
 * Plugin Host Watchdog
 * 监控 UtilityProcess 的健康状态，检测无响应和资源滥用
 */

import { EventEmitter } from 'events'
import log from 'electron-log'

// ============ 类型定义 ============

interface MemorySnapshot {
  timestamp: number
  memory: number
}

interface HostHealth {
  pluginName: string
  lastHeartbeat: number
  missedHeartbeats: number
  memoryUsage: number
  cpuUsage: number
  requestCount: number
  errorCount: number
  lastCpuTime: number      // 上次 CPU 时间（微秒）
  lastCpuTimestamp: number // 上次 CPU 时间戳（毫秒）

  // Phase 4: 内存泄漏检测
  memoryHistory: MemorySnapshot[]  // 内存历史记录（滑动窗口）
  memoryLeakDetected: boolean      // 是否检测到内存泄漏
  memoryGrowthRate: number         // 内存增长率（MB/分钟）

  // Phase 4: 细粒度资源限制
  customLimits?: Partial<WatchdogConfig>  // 插件自定义资源限制
}

export interface WatchdogConfig {
  heartbeatInterval: number    // 心跳检测间隔（毫秒）
  heartbeatTimeout: number     // 心跳超时时间（毫秒）
  maxMissedHeartbeats: number  // 最大允许丢失心跳次数
  maxMemoryMB: number          // 最大内存使用（MB）
  maxRequestsPerMinute: number // 每分钟最大请求数
  maxErrorsPerMinute: number   // 每分钟最大错误数

  // Phase 4: 内存泄漏检测配置
  memoryLeakThresholdMBPerMinute?: number  // 内存泄漏阈值（MB/分钟，默认 10）
  memoryHistorySize?: number               // 内存历史记录大小（默认 12，即 1 分钟）
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: WatchdogConfig = {
  heartbeatInterval: 5000,      // 5 秒
  heartbeatTimeout: 10000,      // 10 秒
  maxMissedHeartbeats: 3,       // 3 次
  maxMemoryMB: 512,             // 512 MB
  maxRequestsPerMinute: 1000,   // 1000 次/分钟
  maxErrorsPerMinute: 50,       // 50 次/分钟

  // Phase 4: 内存泄漏检测
  memoryLeakThresholdMBPerMinute: 10,  // 10 MB/分钟
  memoryHistorySize: 12                // 12 个采样点（1 分钟）
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

    log.info('[Watchdog] Started with config:', this.config)
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

    log.info('[Watchdog] Stopped')
  }

  /**
   * 注册 Host 监控
   * @param pluginName 插件名称
   * @param customLimits 自定义资源限制（可选）
   */
  registerHost(pluginName: string, customLimits?: Partial<WatchdogConfig>): void {
    this.hosts.set(pluginName, {
      pluginName,
      lastHeartbeat: Date.now(),
      missedHeartbeats: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      requestCount: 0,
      errorCount: 0,
      lastCpuTime: 0,
      lastCpuTimestamp: Date.now(),
      // Phase 4: 内存泄漏检测
      memoryHistory: [],
      memoryLeakDetected: false,
      memoryGrowthRate: 0,
      // Phase 4: 细粒度资源限制
      customLimits
    })
  }

  /**
   * 注销 Host 监控
   * Phase 4: 清理内存历史，防止内存泄漏
   */
  unregisterHost(pluginName: string): void {
    const health = this.hosts.get(pluginName)
    if (health) {
      // 清理内存历史数组，释放内存
      health.memoryHistory = []
    }
    this.hosts.delete(pluginName)
  }

  /**
   * Phase 4: 获取插件的有效资源限制
   * 优先使用插件自定义限制，否则使用全局默认配置
   */
  private getEffectiveLimit<K extends keyof WatchdogConfig>(
    pluginName: string,
    key: K
  ): WatchdogConfig[K] {
    const health = this.hosts.get(pluginName)
    if (health?.customLimits && key in health.customLimits) {
      return health.customLimits[key] as WatchdogConfig[K]
    }
    return this.config[key]
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

    // Phase 4: 使用插件特定的速率限制
    const maxRequests = this.getEffectiveLimit(pluginName, 'maxRequestsPerMinute')
    if (health.requestCount > maxRequests) {
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

    // Phase 4: 使用插件特定的错误限制
    const maxErrors = this.getEffectiveLimit(pluginName, 'maxErrorsPerMinute')
    if (health.errorCount >= maxErrors) {
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

    // Phase 4: 记录内存历史（滑动窗口）
    const now = Date.now()
    health.memoryHistory.push({ timestamp: now, memory: memoryMB })

    // Phase 4: 使用插件特定的历史窗口大小
    const maxSize = this.getEffectiveLimit(pluginName, 'memoryHistorySize') || 12
    if (health.memoryHistory.length > maxSize) {
      health.memoryHistory.shift() // 移除最旧的记录
    }

    // 检测内存泄漏
    this.detectMemoryLeak(pluginName, health)

    // Phase 4: 使用插件特定的内存限制
    const maxMemory = this.getEffectiveLimit(pluginName, 'maxMemoryMB')
    if (memoryMB > maxMemory) {
      this.emit('host:memory-exceeded', pluginName, memoryMB)
    }
  }

  /**
   * 检测内存泄漏
   * 使用线性回归分析内存增长趋势
   */
  private detectMemoryLeak(pluginName: string, health: HostHealth): void {
    const history = health.memoryHistory
    const minSamples = 4 // 至少需要 4 个样本点才能进行趋势分析

    if (history.length < minSamples) {
      return // 数据不足，无法判断
    }

    // 使用线性回归计算内存增长率
    // y = mx + b，其中 m 是斜率（增长率）
    const n = history.length
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0

    for (let i = 0; i < n; i++) {
      const x = i // 使用索引作为 x 轴（时间序列）
      const y = history[i].memory
      sumX += x
      sumY += y
      sumXY += x * y
      sumX2 += x * x
    }

    // 计算斜率 m = (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX)
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)

    // 将斜率转换为 MB/分钟
    // slope 是每个采样点的增长量，采样间隔是 heartbeatInterval
    const intervalMinutes = this.config.heartbeatInterval / 60000
    const growthRatePerMinute = slope / intervalMinutes

    health.memoryGrowthRate = growthRatePerMinute

    // Phase 4: 使用插件特定的内存泄漏阈值
    const threshold = this.getEffectiveLimit(pluginName, 'memoryLeakThresholdMBPerMinute') || 10
    const wasLeaking = health.memoryLeakDetected

    if (growthRatePerMinute > threshold) {
      health.memoryLeakDetected = true
      // 只在首次检测到泄漏时发出警告
      if (!wasLeaking) {
        this.emit('host:memory-leak-warning', pluginName, growthRatePerMinute)
      }
    } else {
      health.memoryLeakDetected = false
    }
  }

  /**
   * 更新 CPU 使用
   * @param pluginName 插件名称
   * @param cpuTimeMicroseconds CPU 时间（微秒），user + system 的总和
   */
  updateCpuUsage(pluginName: string, cpuTimeMicroseconds: number): void {
    const health = this.hosts.get(pluginName)
    if (!health) return

    const now = Date.now()
    const timeDelta = now - health.lastCpuTimestamp // 毫秒
    const cpuDelta = cpuTimeMicroseconds - health.lastCpuTime // 微秒

    if (timeDelta > 0 && health.lastCpuTime > 0) {
      // CPU 使用率 = (CPU 时间增量 / 实际时间增量) * 100
      // 将微秒转换为毫秒：cpuDelta / 1000
      const cpuPercent = (cpuDelta / 1000 / timeDelta) * 100
      health.cpuUsage = Math.max(0, Math.min(100, cpuPercent)) // 限制在 0-100%
    }

    // 更新记录
    health.lastCpuTime = cpuTimeMicroseconds
    health.lastCpuTimestamp = now
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
   * Phase 4: 优化事件发射，避免重复通知
   */
  private checkAllHosts(): void {
    const now = Date.now()

    for (const [pluginName, health] of this.hosts) {
      // 检查心跳
      const timeSinceLastHeartbeat = now - health.lastHeartbeat
      if (timeSinceLastHeartbeat > this.config.heartbeatTimeout) {
        health.missedHeartbeats++

        // 只在首次达到阈值时发出警告，避免重复事件
        if (health.missedHeartbeats === this.config.maxMissedHeartbeats) {
          this.emit('host:unresponsive', pluginName)
        }
      } else {
        // 如果心跳正常，重置错过次数
        if (health.missedHeartbeats > 0) {
          health.missedHeartbeats = 0
        }
      }

      // 重置每分钟计数器（简化实现，每次检查时衰减）
      health.requestCount = Math.floor(health.requestCount * 0.8)
      health.errorCount = Math.floor(health.errorCount * 0.8)
    }
  }

  /**
   * 检查 Host 是否健康
   * Phase 4: 使用插件特定的资源限制
   */
  isHostHealthy(pluginName: string): boolean {
    const health = this.hosts.get(pluginName)
    if (!health) return false

    const maxMissedHeartbeats = this.getEffectiveLimit(pluginName, 'maxMissedHeartbeats')
    const maxMemoryMB = this.getEffectiveLimit(pluginName, 'maxMemoryMB')
    const maxErrorsPerMinute = this.getEffectiveLimit(pluginName, 'maxErrorsPerMinute')

    return (
      health.missedHeartbeats < maxMissedHeartbeats &&
      health.memoryUsage < maxMemoryMB &&
      health.errorCount < maxErrorsPerMinute
    )
  }
}
