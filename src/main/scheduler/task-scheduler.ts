/**
 * Task Scheduler - 核心任务调度器
 * 负责任务的创建、调度、执行和管理
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { TaskQueue } from './task-queue'
import { TaskStore } from './task-store'
import { CronParser } from './cron-parser'
import type { Task, TaskInput, TaskExecution, TaskFilter } from './types'
import type { Plugin } from '../../shared/types/plugin'
import { SCHEDULER_IDLE_CHECK_MS } from '../constants/timing'
import log from 'electron-log'

interface SchedulerHostManagerLike {
  isHostReady(pluginId: string): boolean
  initPlugin(plugin: Plugin): Promise<boolean>
  callTaskCallback(plugin: Plugin, callback: string, payload: unknown, task: Task): Promise<unknown>
  destroyHost(pluginId: string): Promise<void>
  getWatchdog(): {
    recordHeartbeat(pluginId: string): void
  }
}

interface SchedulerBackgroundManagerLike {
  isRunning(pluginId: string): boolean
  start(plugin: Plugin, autoStart?: boolean): Promise<boolean>
}

interface SchedulerPluginManagerLike {
  get(pluginId: string): Plugin | undefined
  getHostManager(): SchedulerHostManagerLike
  getBackgroundManager?(): SchedulerBackgroundManagerLike
  getActiveWindowPlugins?(): Array<{ pluginId: string }>
}

export class TaskScheduler extends EventEmitter {
  private queue: TaskQueue
  private store: TaskStore
  private cronParser: CronParser
  private timer: NodeJS.Timeout | null = null
  private running: boolean = false
  private pluginManager: SchedulerPluginManagerLike | null = null  // 将在初始化时注入
  private pluginCleanupTimers: Map<string, NodeJS.Timeout> = new Map()
  private readonly CLEANUP_DELAY_SHORT = 30 * 1000  // 30秒：下一个任务即将执行
  private runningTasks: Set<string> = new Set()
  private readonly MAX_CONCURRENT_TASKS = 5

  constructor() {
    super()
    this.queue = new TaskQueue()
    this.store = new TaskStore()
    this.cronParser = new CronParser()
  }

  /**
   * 设置插件管理器（用于调用插件回调）
   */
  setPluginManager(pluginManager: SchedulerPluginManagerLike): void {
    this.pluginManager = pluginManager
  }

  /**
   * 启动调度器
   */
  async start(): Promise<void> {
    if (this.running) return

    this.running = true

    // 恢复持久化的任务
    await this.restore()

    // 开始调度循环
    this.scheduleNext()
  }

  /**
   * 停止调度器
   */
  stop(): void {
    log.info('[TaskScheduler] Stopping...')
    this.running = false

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    // 清理所有插件清理定时器
    for (const [, timer] of this.pluginCleanupTimers) {
      clearTimeout(timer)
    }
    this.pluginCleanupTimers.clear()

    log.info('[TaskScheduler] Stopped')
  }

  /**
   * 创建任务
   */
  async createTask(input: TaskInput): Promise<Task> {
    // 验证输入
    this.validateTaskInput(input)

    // 创建任务对象
    const now = Date.now()
    const task: Task = {
      id: randomUUID(),
      ...input,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      executionCount: 0,
      failureCount: 0
    }

    // 计算下次执行时间
    task.nextRunTime = this.calculateNextRunTime(task) ?? undefined

    // 保存到数据库
    await this.store.saveTask(task)

    // 加入队列
    if (task.nextRunTime && task.status === 'pending') {
      this.queue.push(task)
      this.scheduleNext()  // 重新调度
    }

    this.emit('task:created', task)

    return task
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = await this.store.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    // 从队列中移除
    this.queue.remove(taskId)

    // 更新状态
    task.status = 'cancelled'
    task.updatedAt = Date.now()
    await this.store.saveTask(task)

    this.emit('task:cancelled', task)
  }

  /**
   * 暂停任务
   */
  async pauseTask(taskId: string): Promise<void> {
    const task = await this.store.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    if (task.status !== 'pending') {
      throw new Error(`Task cannot be paused: ${task.status}`)
    }

    // 从队列中移除
    this.queue.remove(taskId)

    // 更新状态
    task.status = 'paused'
    task.updatedAt = Date.now()
    await this.store.saveTask(task)

    this.emit('task:paused', task)
  }

  /**
   * 恢复任务
   */
  async resumeTask(taskId: string): Promise<void> {
    const task = await this.store.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    if (task.status !== 'paused') {
      throw new Error(`Task is not paused: ${task.status}`)
    }

    // 更新状态
    task.status = 'pending'
    task.updatedAt = Date.now()

    // 重新计算下次执行时间
    task.nextRunTime = this.calculateNextRunTime(task) ?? undefined

    await this.store.saveTask(task)

    // 加入队列
    if (task.nextRunTime) {
      this.queue.push(task)
      this.scheduleNext()
    }

    this.emit('task:resumed', task)
  }

  /**
   * 获取任务
   */
  async getTask(taskId: string): Promise<Task | null> {
    return await this.store.getTask(taskId)
  }

  /**
   * 列出任务
   */
  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    return await this.store.listTasks(filter)
  }

  /**
   * 获取任务总数
   */
  async getTaskCount(filter?: Omit<TaskFilter, 'limit' | 'offset'>): Promise<number> {
    return await this.store.getTaskCount(filter)
  }

  /**
   * 批量删除任务
   */
  async deleteTasks(taskIds: string[]): Promise<number> {
    let deletedCount = 0
    const deletedTaskIds: string[] = []
    for (const taskId of taskIds) {
      try {
        // 从队列中移除
        this.queue.remove(taskId)
        // 从数据库删除
        await this.store.deleteTask(taskId)
        deletedCount++
        deletedTaskIds.push(taskId)
      } catch (err) {
        log.error(`[TaskScheduler] Failed to delete task ${taskId}:`, err)
      }
    }
    if (deletedCount > 0) {
      this.emit('tasks:deleted', {
        taskIds: deletedTaskIds,
        deletedCount
      })
    }
    return deletedCount
  }

  /**
   * 清除已完成/失败/取消的任务
   */
  async cleanupTasks(olderThan?: number): Promise<number> {
    const deletedCount = await this.store.cleanupTasks(olderThan)
    if (deletedCount > 0) {
      this.emit('tasks:cleaned', {
        deletedCount
      })
    }
    return deletedCount
  }

  /**
   * 获取执行历史
   */
  async getExecutions(taskId: string, limit?: number): Promise<TaskExecution[]> {
    return await this.store.getExecutions(taskId, limit)
  }

  /**
   * 验证 cron 表达式
   */
  validateCron(expression: string): boolean {
    return this.cronParser.validate(expression)
  }

  /**
   * 获取下次 cron 执行时间
   */
  getNextCronTime(expression: string, after?: Date): Date {
    return this.cronParser.getNextTime(expression, after)
  }

  /**
   * 获取 cron 表达式描述
   */
  describeCron(expression: string): string {
    return this.cronParser.describe(expression)
  }

  /**
   * 恢复持久化的任务
   */
  private async restore(): Promise<void> {
    const tasks = await this.store.getPendingTasks()
    const now = Date.now()
    const PRESTART_THRESHOLD = 60000  // 1分钟内要执行的任务，预启动插件

    // 收集需要自动启动的插件
    const pluginsToStart = new Set<string>()
    const pluginsToPrestart = new Set<string>()

    for (const task of tasks) {
      // 恢复 nextRunTime 策略：
      // - repeat（cron）任务：重新计算下次执行时间（基于当前时间）
      // - delay / once 任务：保留持久化的到期时间
      //   如果已过期，设置为立即执行（now），而非重新延迟
      if (task.type === 'repeat') {
        task.nextRunTime = this.calculateNextRunTime(task) ?? undefined
      } else if (task.nextRunTime && task.nextRunTime <= now) {
        // 已过期的 delay/once 任务，立即执行
        task.nextRunTime = now
      }
      // 如果 nextRunTime 仍有效（未过期的 delay/once），沿用原值

      if (task.nextRunTime) {
        this.queue.push(task)
        await this.store.saveTask(task)

        // 记录需要启动的插件
        const plugin = this.pluginManager?.get(task.pluginId)
        if (plugin && plugin.enabled) {
          const supportsBackground = plugin.manifest.pluginSetting?.background === true

          if (supportsBackground) {
            // 后台插件：始终启动
            pluginsToStart.add(task.pluginId)
          } else if (task.nextRunTime - now <= PRESTART_THRESHOLD) {
            // 非后台插件：如果任务在1分钟内执行，预启动
            pluginsToPrestart.add(task.pluginId)
          }
        }
      } else {
        // 任务已过期，标记为完成
        task.status = 'completed'
        await this.store.saveTask(task)
      }
    }

    // 自动启动后台插件
    if (this.pluginManager && pluginsToStart.size > 0) {
      const backgroundManager = this.pluginManager.getBackgroundManager?.()
      if (!backgroundManager) {
        log.warn('[TaskScheduler] Background manager unavailable, skip auto-starting background plugins')
      }

      if (backgroundManager) {
        for (const pluginId of pluginsToStart) {
          const plugin = this.pluginManager.get(pluginId)
          if (!plugin) {
            continue
          }

          // 检查是否已在运行
          if (backgroundManager.isRunning(pluginId)) {
            continue
          }

          // 启动后台插件
          try {
            log.info(`[TaskScheduler] Auto-starting background plugin: ${pluginId}`)
            await backgroundManager.start(plugin, true)
          } catch (err) {
            log.error(`[TaskScheduler] Error auto-starting plugin ${pluginId}:`, err)
          }
        }
      }
    }

    // 预启动非后台插件（只初始化 Host，不启动后台）
    if (this.pluginManager && pluginsToPrestart.size > 0) {
      const hostManager = this.pluginManager.getHostManager()

      for (const pluginId of pluginsToPrestart) {
        const plugin = this.pluginManager.get(pluginId)
        if (!plugin) {
          continue
        }

        // 检查 Host 是否已就绪
        if (hostManager.isHostReady(pluginId)) {
          continue
        }

        // 预初始化插件
        try {
          log.info(`[TaskScheduler] Pre-initializing plugin for upcoming task: ${pluginId}`)
          await hostManager.initPlugin(plugin)
        } catch (err) {
          log.error(`[TaskScheduler] Error pre-initializing plugin ${pluginId}:`, err)
        }
      }
    }

    log.info(`[TaskScheduler] Restored ${tasks.length} tasks, started ${pluginsToStart.size} background plugins, pre-initialized ${pluginsToPrestart.size} plugins`)
  }

  /**
   * 调度下一个任务
   */
  private scheduleNext(): void {
    if (!this.running) return

    // 清除现有定时器
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    // 尝试执行所有到期的任务（并发控制）
    this.executeReadyTasks()

    // 调度下一个任务
    const nextTask = this.queue.peek()

    if (!nextTask || !nextTask.nextRunTime) {
      // 没有待执行任务，1分钟后再检查
      this.timer = setTimeout(() => this.scheduleNext(), SCHEDULER_IDLE_CHECK_MS)
      return
    }

    const now = Date.now()
    const delay = nextTask.nextRunTime - now

    if (delay <= 0) {
      // 立即执行
      setImmediate(() => this.scheduleNext())
    } else {
      // 设置定时器（最大值限制）
      const actualDelay = Math.min(delay, 2147483647)
      this.timer = setTimeout(() => {
        this.scheduleNext()
      }, actualDelay)
    }
  }

  /**
   * 执行所有到期的任务（并发控制）
   */
  private async executeReadyTasks(): Promise<void> {
    const now = Date.now()

    while (this.runningTasks.size < this.MAX_CONCURRENT_TASKS) {
      const nextTask = this.queue.peek()

      // 没有任务或任务未到期
      if (!nextTask || !nextTask.nextRunTime || nextTask.nextRunTime > now) {
        break
      }

      // 从队列移除
      this.queue.pop()

      // 异步执行任务（不等待）
      this.executeTask(nextTask).catch(err => {
        log.error(`[TaskScheduler] Unhandled error in task ${nextTask.id}:`, err)
      })
    }
  }

  /**
   * 执行任务
   */
  private async executeTask(task: Task): Promise<void> {
    // 标记任务正在执行
    this.runningTasks.add(task.id)

    // 更新状态
    task.status = 'running'
    task.lastRunTime = Date.now()
    await this.store.saveTask(task)

    // 创建执行记录
    const execution: TaskExecution = {
      id: randomUUID(),
      taskId: task.id,
      startTime: Date.now(),
      status: 'success'
    }

    try {
      // 执行任务（带超时）
      const result = await this.executeWithTimeout(task)

      execution.endTime = Date.now()
      execution.duration = execution.endTime - execution.startTime
      execution.result = result
      execution.status = 'success'

      // 更新任务状态
      task.status = 'pending'
      task.executionCount++
      task.failureCount = 0
      task.lastError = undefined

      // 计算下次执行时间
      if (task.type === 'repeat') {
        task.nextRunTime = this.calculateNextRunTime(task) ?? undefined
        if (task.nextRunTime) {
          this.queue.push(task)
        } else {
          task.status = 'completed'
        }
      } else {
        task.status = 'completed'
      }

      this.emit('task:success', task, result)

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      execution.endTime = Date.now()
      execution.duration = execution.endTime - execution.startTime
      execution.status = errorMessage === 'timeout' ? 'timeout' : 'failed'
      execution.error = errorMessage

      // 更新任务状态
      task.failureCount++
      task.lastError = errorMessage

      // 重试逻辑
      if (task.maxRetries && task.failureCount <= task.maxRetries) {
        task.status = 'pending'
        task.nextRunTime = Date.now() + (task.retryDelay || 60000)
        this.queue.push(task)
      } else {
        task.status = 'failed'
        log.error(`[TaskScheduler] Task failed: ${task.id}`, error)
      }

      this.emit('task:failed', task, error)
    } finally {
      // 保存执行记录和任务状态（确保即使出错也会保存）
      task.updatedAt = Date.now()
      try {
        await this.store.saveExecution(execution)
        await this.store.saveTask(task)
      } catch (saveError) {
        log.error(`[TaskScheduler] Failed to save task/execution: ${task.id}`, saveError)
      }

      // 移除运行标记
      this.runningTasks.delete(task.id)

      // 触发下一轮调度（检查是否有更多任务可以执行）
      setImmediate(() => this.scheduleNext())
    }
  }

  /**
   * 带超时的任务执行
   */
  private async executeWithTimeout(task: Task): Promise<unknown> {
    const timeout = task.timeout || 30000

    return Promise.race([
      this.callPluginCallback(task),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeout)
      )
    ])
  }

  /**
   * 调用插件回调
   */
  private async callPluginCallback(task: Task): Promise<unknown> {
    if (!this.pluginManager) {
      throw new Error('PluginManager not set')
    }

    const plugin = this.pluginManager.get(task.pluginId)
    if (!plugin) {
      throw new Error(`Plugin not found: ${task.pluginId}`)
    }

    // 检查插件是否已启用
    if (!plugin.enabled) {
      throw new Error(`Plugin is disabled: ${task.pluginId}`)
    }

    // 获取 HostManager 和 BackgroundManager
    const hostManager = this.pluginManager.getHostManager()
    const backgroundManager = this.pluginManager.getBackgroundManager?.()
    const watchdog = hostManager.getWatchdog()

    // 检查插件是否支持后台运行
    const supportsBackground = plugin.manifest.pluginSetting?.background === true

    // 取消清理定时器（如果存在）
    if (this.pluginCleanupTimers.has(task.pluginId)) {
      clearTimeout(this.pluginCleanupTimers.get(task.pluginId)!)
      this.pluginCleanupTimers.delete(task.pluginId)
    }

    // 如果插件支持后台运行但未运行，自动启动后台进程
    if (supportsBackground && !backgroundManager?.isRunning(task.pluginId)) {
      if (!backgroundManager) {
        throw new Error(`Background manager not available for plugin: ${task.pluginId}`)
      }
      const started = await backgroundManager.start(plugin, true)
      if (!started) {
        throw new Error(`Failed to auto-start background plugin: ${task.pluginId}`)
      }
    }

    // 确保 Host 已初始化
    if (!hostManager.isHostReady(task.pluginId)) {
      // 尝试初始化插件
      const initialized = await hostManager.initPlugin(plugin)
      if (!initialized) {
        throw new Error(`Failed to initialize plugin: ${task.pluginId}`)
      }
    }

    // 在执行任务前记录心跳，给任务执行留出足够时间
    watchdog.recordHeartbeat(task.pluginId)

    try {
      // 调用插件的回调方法
      return await hostManager.callTaskCallback(plugin, task.callback, task.payload, task)
    } finally {
      // 如果不支持后台运行，设置清理定时器
      if (!supportsBackground) {
        this.schedulePluginCleanup(task.pluginId)
      }
    }
  }

  /**
   * 调度插件清理
   * 智能延迟销毁：如果下一个任务在 30 秒内执行，保持进程；否则立即销毁
   */
  private schedulePluginCleanup(pluginId: string): void {
    const now = Date.now()

    // 查找该插件的下一个待执行任务
    const nextTask = this.queue.toArray()
      .filter(t => t.pluginId === pluginId && t.nextRunTime && t.nextRunTime > now)
      .sort((a, b) => (a.nextRunTime ?? 0) - (b.nextRunTime ?? 0))[0]

    if (!nextTask) {
      // 没有待执行任务，立即销毁
      this.cleanupPlugin(pluginId)
      return
    }

    const timeUntilNextTask = (nextTask.nextRunTime ?? 0) - now

    if (timeUntilNextTask > this.CLEANUP_DELAY_SHORT) {
      // 下一个任务超过 30 秒后执行，立即销毁
      this.cleanupPlugin(pluginId)
      return
    }

    // 下一个任务在 30 秒内执行，延迟销毁
    const timer = setTimeout(async () => {
      // 再次检查是否有即将执行的任务
      const stillHasUpcomingTask = this.queue.toArray().some(t =>
        t.pluginId === pluginId &&
        t.nextRunTime &&
        t.nextRunTime > Date.now() &&
        t.nextRunTime - Date.now() <= this.CLEANUP_DELAY_SHORT
      )

      if (!stillHasUpcomingTask) {
        this.cleanupPlugin(pluginId)
      }

      this.pluginCleanupTimers.delete(pluginId)
    }, timeUntilNextTask)

    this.pluginCleanupTimers.set(pluginId, timer)
  }

  /**
   * 清理插件进程
   */
  private async cleanupPlugin(pluginId: string): Promise<void> {
    if (!this.pluginManager) return

    const backgroundManager = this.pluginManager.getBackgroundManager?.()
    if (backgroundManager?.isRunning?.(pluginId)) {
      return
    }

    const activeWindowPlugins = this.pluginManager.getActiveWindowPlugins?.()
    if (Array.isArray(activeWindowPlugins) && activeWindowPlugins.some((item: { pluginId: string }) => item.pluginId === pluginId)) {
      return
    }

    const hostManager = this.pluginManager.getHostManager()
    if (hostManager.isHostReady(pluginId)) {
      log.info(`[TaskScheduler] Cleaning up plugin: ${pluginId}`)
      await hostManager.destroyHost(pluginId)
    }
  }

  /**
   * 计算下次执行时间
   */
  private calculateNextRunTime(task: Task): number | null {
    const now = Date.now()

    switch (task.type) {
      case 'once':
        // 一次性任务
        if (task.time && task.time > now) {
          return task.time
        }
        return null

      case 'delay':
        // 延迟任务
        if (task.delay) {
          return now + task.delay
        }
        return null

      case 'repeat':
        // 重复任务
        if (!task.cron) return null

        // 检查结束条件
        if (task.endTime && now >= task.endTime) return null
        if (task.maxExecutions && task.executionCount >= task.maxExecutions) return null

        // 计算下次执行时间
        try {
          const nextTime = this.cronParser.getNextTime(task.cron, new Date(now), task.timezone)
          return nextTime.getTime()
        } catch {
          return null
        }

      default:
        return null
    }
  }

  /**
   * 验证任务输入
   */
  private validateTaskInput(input: TaskInput): void {
    if (!input.pluginId) {
      throw new Error('pluginId is required')
    }
    if (!input.name) {
      throw new Error('name is required')
    }
    if (!input.callback) {
      throw new Error('callback is required')
    }

    switch (input.type) {
      case 'once':
        if (!input.time) {
          throw new Error('time is required for once task')
        }
        if (input.time <= Date.now()) {
          throw new Error('time must be in the future')
        }
        break

      case 'delay':
        if (!input.delay || input.delay <= 0) {
          throw new Error('delay must be positive for delay task')
        }
        break

      case 'repeat':
        if (!input.cron) {
          throw new Error('cron is required for repeat task')
        }
        if (!this.cronParser.validate(input.cron)) {
          throw new Error('invalid cron expression')
        }
        // 验证 cron 表达式与时区的组合是否合法
        // 无效时区（如 'Foo/Bar'）会导致 getNextTime 抛异常，
        // 在此提前拒绝，避免创建永远不会被调度的僵尸任务
        if (input.timezone) {
          try {
            this.cronParser.getNextTime(input.cron, new Date(), input.timezone)
          } catch {
            throw new Error(`invalid timezone: ${input.timezone}`)
          }
        }
        break

      default:
        throw new Error(`invalid task type: ${input.type}`)
    }
  }

  /**
   * 关闭调度器
   */
  async shutdown(): Promise<void> {
    this.stop()
    this.store.close()
  }
}
