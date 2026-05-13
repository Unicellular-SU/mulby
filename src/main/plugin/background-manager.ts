/**
 * Background Plugin Manager
 * 管理后台运行的插件
 */

import { EventEmitter } from 'events'
import type { Plugin, BackgroundPluginInfo } from '../../shared/types/plugin'
import type { PluginHostManager } from './host-manager'
import type { PluginHostWatchdog } from './watchdog'
import type { PluginStateManager } from './state'
import { BG_BATCH_DELAY_MS, BG_FORCE_STOP_TIMEOUT_MS } from '../constants/timing'
import { shouldRestorePersistentBackgroundPlugin } from './background-policy'
import log from 'electron-log'

// ============ 类型定义 ============

interface BackgroundPlugin {
  plugin: Plugin
  startedAt: number
  runtimeTimer?: NodeJS.Timeout  // 运行时间限制定时器
  restoreAttempts?: number        // 恢复尝试次数
}

// ============ 常量 ============

// 后台插件专用的 Watchdog 配置（更严格）
export const BACKGROUND_WATCHDOG_CONFIG = {
  heartbeatInterval: 5000,       // 5 秒
  heartbeatTimeout: 10000,       // 10 秒
  maxMissedHeartbeats: 3,        // 3 次
  maxMemoryMB: 256,              // 256 MB（后台插件更严格）
  maxRequestsPerMinute: 500,     // 500 次/分钟（后台插件更严格）
  maxErrorsPerMinute: 30         // 30 次/分钟（后台插件更严格）
}

const MAX_RESTORE_ATTEMPTS = 3   // 最大恢复尝试次数

export class BackgroundPluginManager extends EventEmitter {
  private backgroundPlugins: Map<string, BackgroundPlugin> = new Map()
  private hostManager: PluginHostManager
  private watchdog: PluginHostWatchdog
  private stateManager: PluginStateManager
  private restoreTimer: NodeJS.Timeout | null = null
  // 持有 watchdog 监听器引用，便于 shutdown 时移除
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private watchdogHandlers: { event: string; handler: (...args: any[]) => void }[] = []

  constructor(
    hostManager: PluginHostManager,
    watchdog: PluginHostWatchdog,
    stateManager: PluginStateManager
  ) {
    super()
    this.hostManager = hostManager
    this.watchdog = watchdog
    this.stateManager = stateManager
    this.setupWatchdogListeners()
  }

  /**
   * 设置 Watchdog 事件监听
   */
  private setupWatchdogListeners(): void {
    const onUnresponsive = (pluginId: string) => {
      if (this.isRunning(pluginId)) {
        log.warn(`[BackgroundManager] Plugin ${pluginId} unresponsive, stopping`)
        this.stop(pluginId, 'unresponsive')
      }
    }

    const onMemoryExceeded = (pluginId: string, memoryMB: number) => {
      if (this.isRunning(pluginId)) {
        log.warn(`[BackgroundManager] Plugin ${pluginId} memory exceeded: ${memoryMB}MB, stopping`)
        this.stop(pluginId, 'memory-exceeded')
      }
    }

    const onErrorThreshold = (pluginId: string, errorCount: number) => {
      if (this.isRunning(pluginId)) {
        log.warn(`[BackgroundManager] Plugin ${pluginId} error threshold: ${errorCount}, stopping`)
        this.stop(pluginId, 'error-threshold')
      }
    }

    // Phase 4: 内存泄漏警告
    const onMemoryLeak = (pluginId: string, growthRate: number) => {
      if (this.isRunning(pluginId)) {
        log.warn(`[BackgroundManager] Plugin ${pluginId} memory leak detected: ${growthRate.toFixed(2)}MB/min`)
        // 记录警告但不立即停止，让用户决定是否停止
      }
    }

    this.watchdog.on('host:unresponsive', onUnresponsive)
    this.watchdog.on('host:memory-exceeded', onMemoryExceeded)
    this.watchdog.on('host:error-threshold', onErrorThreshold)
    this.watchdog.on('host:memory-leak-warning', onMemoryLeak)

    this.watchdogHandlers = [
      { event: 'host:unresponsive', handler: onUnresponsive },
      { event: 'host:memory-exceeded', handler: onMemoryExceeded },
      { event: 'host:error-threshold', handler: onErrorThreshold },
      { event: 'host:memory-leak-warning', handler: onMemoryLeak },
    ]
  }

  /**
   * 移除 watchdog 事件监听器，防止 EventEmitter 泄漏
   */
  private removeWatchdogListeners(): void {
    for (const { event, handler } of this.watchdogHandlers) {
      this.watchdog.removeListener(event, handler)
    }
    this.watchdogHandlers = []
  }

  /**
   * 启动后台插件
   */
  async start(plugin: Plugin, callOnBackground: boolean = true): Promise<boolean> {
    const pluginId = plugin.id

    log.info(`[BackgroundManager] Attempting to start plugin ${pluginId}`)

    // 检查是否允许后台运行
    if (!plugin.manifest.pluginSetting?.background) {
      log.warn(`[BackgroundManager] Plugin ${pluginId} does not support background mode`)
      return false
    }

    // 检查是否已在运行
    if (this.isRunning(pluginId)) {
      log.warn(`[BackgroundManager] Plugin ${pluginId} is already running in background`)
      return true
    }

    try {
      // 确保 Host 已创建并初始化
      const hostReady = this.hostManager.isHostReady(pluginId)
      log.info(`[BackgroundManager] Host ready status for ${pluginId}: ${hostReady}`)

      if (!hostReady) {
        log.info(`[BackgroundManager] Creating host for ${pluginId}`)
        const created = await this.hostManager.createHost(plugin)
        if (!created) {
          throw new Error('Failed to create host')
        }
        log.info(`[BackgroundManager] Initializing plugin ${pluginId}`)
        await this.hostManager.initPlugin(plugin)
      }

      // 调用 onBackground 钩子（如果需要）
      if (callOnBackground) {
        log.info(`[BackgroundManager] Calling onBackground hook for ${pluginId}`)
        await this.hostManager.callHook(plugin, 'onBackground')
      }

      // 注册到后台插件列表
      const backgroundPlugin: BackgroundPlugin = {
        plugin,
        startedAt: Date.now()
      }

      this.backgroundPlugins.set(pluginId, backgroundPlugin)

      // 注册到 Watchdog（后台插件始终监控）
      this.watchdog.registerHost(pluginId)
      log.info(`[BackgroundManager] Registered ${pluginId} to Watchdog`)

      // 设置运行时间限制
      const maxRuntime = plugin.manifest.pluginSetting?.maxRuntime || 0
      if (maxRuntime > 0) {
        log.info(`[BackgroundManager] Setting maxRuntime for ${pluginId}: ${maxRuntime}ms`)
        backgroundPlugin.runtimeTimer = setTimeout(() => {
          log.info(`[BackgroundManager] Plugin ${pluginId} reached maxRuntime, stopping`)
          this.stop(pluginId, 'max-runtime')
        }, maxRuntime)
      }

      // 更新状态
      this.stateManager.setBackgroundRunning(pluginId, true)

      // 触发事件
      this.emit('background:started', pluginId)

      log.info(`[BackgroundManager] Plugin ${pluginId} started in background successfully`)
      return true
    } catch (err) {
      log.error(`[BackgroundManager] Failed to start plugin ${pluginId}:`, err)
      return false
    }
  }

  /**
   * 停止后台插件
   */
  async stop(
    pluginId: string,
    reason: string = 'manual',
    options: { preserveRunningState?: boolean } = {}
  ): Promise<void> {
    const backgroundPlugin = this.backgroundPlugins.get(pluginId)
    if (!backgroundPlugin) {
      return
    }

    try {
      // 清理运行时间定时器
      if (backgroundPlugin.runtimeTimer) {
        clearTimeout(backgroundPlugin.runtimeTimer)
      }

      // 从后台列表移除
      this.backgroundPlugins.delete(pluginId)

      // 注销 Watchdog 监控
      this.watchdog.unregisterHost(pluginId)

      // 销毁 Host 进程
      await this.hostManager.destroyHost(pluginId)

      // 更新状态。应用退出恢复场景需要保留 backgroundRunning=true，供下次启动恢复。
      if (!options.preserveRunningState) {
        this.stateManager.setBackgroundRunning(pluginId, false)
      }

      // 触发事件
      this.emit('background:stopped', pluginId, reason)

      log.info(`[BackgroundManager] Plugin ${pluginId} stopped (reason: ${reason})`)
    } catch (err) {
      log.error(`[BackgroundManager] Error stopping plugin ${pluginId}:`, err)
    }
  }

  /**
   * 列出所有后台插件
   */
  list(): BackgroundPluginInfo[] {
    const result: BackgroundPluginInfo[] = []

    for (const [pluginId, backgroundPlugin] of this.backgroundPlugins) {
      const plugin = backgroundPlugin.plugin
      const health = this.watchdog.getHostHealth(pluginId)
      const uptime = Date.now() - backgroundPlugin.startedAt

      result.push({
        pluginId,
        pluginName: plugin.manifest.name,
        displayName: plugin.manifest.displayName,
        startedAt: backgroundPlugin.startedAt,
        uptime,
        persistent: plugin.manifest.pluginSetting?.persistent ?? false,
        maxRuntime: plugin.manifest.pluginSetting?.maxRuntime ?? 0,
        memoryUsage: health?.memoryUsage ?? 0,
        cpuUsage: health?.cpuUsage ?? 0,
        requestCount: health?.requestCount ?? 0,
        errorCount: health?.errorCount ?? 0,
        healthy: this.watchdog.isHostHealthy(pluginId),
        lastHeartbeat: health?.lastHeartbeat ?? 0,
        missedHeartbeats: health?.missedHeartbeats ?? 0,
        runMode: 'background'
      })
    }

    return result
  }

  /**
   * 获取插件运行时信息
   */
  getInfo(pluginId: string): BackgroundPluginInfo | null {
    const backgroundPlugin = this.backgroundPlugins.get(pluginId)
    if (!backgroundPlugin) {
      return null
    }

    const plugin = backgroundPlugin.plugin
    const health = this.watchdog.getHostHealth(pluginId)
    const uptime = Date.now() - backgroundPlugin.startedAt

    return {
      pluginId,
      pluginName: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      startedAt: backgroundPlugin.startedAt,
      uptime,
      persistent: plugin.manifest.pluginSetting?.persistent ?? false,
      maxRuntime: plugin.manifest.pluginSetting?.maxRuntime ?? 0,
      memoryUsage: health?.memoryUsage ?? 0,
      cpuUsage: health?.cpuUsage ?? 0,
      requestCount: health?.requestCount ?? 0,
      errorCount: health?.errorCount ?? 0,
      healthy: this.watchdog.isHostHealthy(pluginId),
      lastHeartbeat: health?.lastHeartbeat ?? 0,
      missedHeartbeats: health?.missedHeartbeats ?? 0,
      runMode: 'background'
    }
  }

  /**
   * 检查插件是否在后台运行
   */
  isRunning(pluginId: string): boolean {
    return this.backgroundPlugins.has(pluginId)
  }

  /**
   * 恢复持久化的后台插件（应用启动时调用）
   */
  async restorePersistent(plugins: Plugin[]): Promise<void> {
    this.cancelRestoreTimer()

    const pluginsToRestore = plugins.filter(plugin => {
      const state = this.stateManager.getPluginState(plugin.id)
      return shouldRestorePersistentBackgroundPlugin(plugin, state)
    })

    if (pluginsToRestore.length === 0) {
      log.info('[BackgroundManager] No persistent plugins to restore')
      return
    }

    log.info(`[BackgroundManager] Found ${pluginsToRestore.length} persistent plugins to restore:`,
      pluginsToRestore.map(p => p.id))

    // 延迟 2 秒启动，避免影响应用启动速度
    this.restoreTimer = setTimeout(async () => {
      this.restoreTimer = null
      log.info('[BackgroundManager] Starting to restore persistent plugins...')
      const startTime = Date.now()

      // 批量限制：同时最多恢复 3 个插件
      const batchSize = 3
      let successCount = 0
      let failCount = 0
      const failedPlugins: Plugin[] = []

      for (let i = 0; i < pluginsToRestore.length; i += batchSize) {
        const batch = pluginsToRestore.slice(i, i + batchSize)
        const batchNum = Math.floor(i / batchSize) + 1
        const totalBatches = Math.ceil(pluginsToRestore.length / batchSize)

        log.info(`[BackgroundManager] Processing batch ${batchNum}/${totalBatches}:`, batch.map(p => p.id))

        const results = await Promise.allSettled(
          batch.map(async plugin => {
            try {
              log.info(`[BackgroundManager] Restoring plugin: ${plugin.id}`)
              const success = await this.start(plugin, true)

              if (success) {
                log.info(`[BackgroundManager] ✓ Successfully restored plugin: ${plugin.id}`)
                return { success: true, pluginId: plugin.id, plugin }
              } else {
                log.warn(`[BackgroundManager] ✗ Failed to restore plugin: ${plugin.id}`)
                return { success: false, pluginId: plugin.id, plugin, error: 'Start returned false' }
              }
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : 'Unknown error'
              log.error(`[BackgroundManager] ✗ Error restoring plugin ${plugin.id}:`, errorMsg)
              return { success: false, pluginId: plugin.id, plugin, error: errorMsg }
            }
          })
        )

        // 统计结果
        results.forEach(result => {
          if (result.status === 'fulfilled') {
            if (result.value.success) {
              successCount++
            } else {
              failCount++
              failedPlugins.push(result.value.plugin)
            }
          } else {
            failCount++
          }
        })

        // 批次之间延迟 500ms，避免资源峰值
        if (i + batchSize < pluginsToRestore.length) {
          await new Promise(resolve => setTimeout(resolve, BG_BATCH_DELAY_MS))
        }
      }

      const duration = Date.now() - startTime
      log.info(`[BackgroundManager] Restore completed in ${duration}ms: ${successCount} succeeded, ${failCount} failed`)

      // 对失败的插件进行重试（最多重试 2 次）
      if (failedPlugins.length > 0) {
        log.info(`[BackgroundManager] Retrying ${failedPlugins.length} failed plugins...`)
        await this.retryFailedPlugins(failedPlugins)
      }

      // 触发恢复完成事件
      this.emit('restore:completed', { successCount, failCount, duration })
    }, 2000)
  }

  /**
   * 重试失败的插件恢复
   */
  private async retryFailedPlugins(plugins: Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      const state = this.stateManager.getPluginState(plugin.id)
      const attempts = (state.backgroundRestartCount || 0) + 1

      if (attempts > MAX_RESTORE_ATTEMPTS) {
        log.warn(`[BackgroundManager] Plugin ${plugin.id} exceeded max restore attempts (${MAX_RESTORE_ATTEMPTS}), giving up`)
        this.stateManager.setBackgroundRunning(plugin.id, false)
        continue
      }

      log.info(`[BackgroundManager] Retry attempt ${attempts}/${MAX_RESTORE_ATTEMPTS} for plugin: ${plugin.id}`)

      // 延迟重试，避免立即失败
      await new Promise(resolve => setTimeout(resolve, 2000 * attempts))

      try {
        const success = await this.start(plugin, true)
        if (success) {
          log.info(`[BackgroundManager] ✓ Successfully restored plugin on retry: ${plugin.id}`)
          // 重置重试计数
          this.stateManager.resetBackgroundRestartCount(plugin.id)
        } else {
          log.warn(`[BackgroundManager] ✗ Failed to restore plugin on retry: ${plugin.id}`)
          // 更新重试计数
          this.updateRestartCount(plugin.id, attempts)
        }
      } catch (err) {
        log.error(`[BackgroundManager] ✗ Error on retry for plugin ${plugin.id}:`, err)
        this.updateRestartCount(plugin.id, attempts)
      }
    }
  }

  /**
   * 更新插件的重启计数
   */
  private updateRestartCount(pluginId: string, count: number): void {
    this.stateManager.updateBackgroundRestartCount(pluginId, count)
    this.stateManager.setBackgroundRunning(pluginId, false)
  }

  /**
   * 停止所有后台插件
   */
  async stopAll(options: { preserveRunningStateFor?: ReadonlySet<string> } = {}): Promise<void> {
    this.cancelRestoreTimer()
    const pluginIds = Array.from(this.backgroundPlugins.keys())
    await Promise.all(pluginIds.map(id => this.stop(id, 'shutdown', {
      preserveRunningState: options.preserveRunningStateFor?.has(id) === true
    })))
  }

  /**
   * 应用退出时的优雅关闭
   */
  async shutdown(): Promise<void> {
    this.cancelRestoreTimer()
    this.removeWatchdogListeners()
    const plugins = this.list()

    if (plugins.length === 0) {
      log.info('[BackgroundManager] No background plugins to shutdown')
      return
    }

    log.info(`[BackgroundManager] Shutting down ${plugins.length} background plugins...`)

    // 保存状态。只有 persistent 后台插件需要在下次启动恢复。
    const preserveRunningStateFor = new Set<string>()
    for (const info of plugins) {
      log.info(`[BackgroundManager] Saving state for plugin: ${info.pluginId}`)
      const shouldPreserve = info.persistent === true
      this.stateManager.setBackgroundRunning(info.pluginId, shouldPreserve)
      if (shouldPreserve) {
        preserveRunningStateFor.add(info.pluginId)
      }
    }

    // 优雅退出（最多等待 3 秒）
    const startTime = Date.now()
    await Promise.race([
      this.stopAll({ preserveRunningStateFor }),
      new Promise(resolve => setTimeout(resolve, BG_FORCE_STOP_TIMEOUT_MS))
    ])

    const duration = Date.now() - startTime
    log.info(`[BackgroundManager] Shutdown completed in ${duration}ms`)
  }

  private cancelRestoreTimer(): void {
    if (!this.restoreTimer) return
    clearTimeout(this.restoreTimer)
    this.restoreTimer = null
  }
}
