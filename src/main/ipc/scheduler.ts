/**
 * Task Scheduler IPC Handlers
 */

import { ipcMain } from 'electron'
import type { PluginManager } from '../plugin/manager'
import type { TaskSchedulerEvent } from '../../shared/types/task'

interface SchedulerSubscriptionEntry {
  sender: Electron.WebContents
  cleanup: () => void
  destroyHandler: () => void
}

export function registerSchedulerHandlers(pluginManager: PluginManager) {
  const schedulerSubscriptions = new Map<number, SchedulerSubscriptionEntry>()

  const getScheduler = () => {
    return (pluginManager as any).taskScheduler
  }

  const clearSchedulerSubscription = (webContentsId: number) => {
    const entry = schedulerSubscriptions.get(webContentsId)
    if (!entry) return
    entry.sender.removeListener('destroyed', entry.destroyHandler)
    entry.cleanup()
    schedulerSubscriptions.delete(webContentsId)
  }

  const subscribeSchedulerEvents = (sender: Electron.WebContents) => {
    const scheduler = getScheduler()
    const webContentsId = sender.id
    clearSchedulerSubscription(webContentsId)

    const extractTaskId = (input: unknown): string | undefined => {
      if (!input || typeof input !== 'object') return undefined
      const maybeTask = input as { id?: unknown }
      return typeof maybeTask.id === 'string' ? maybeTask.id : undefined
    }

    const sendEvent = (payload: TaskSchedulerEvent) => {
      if (!sender.isDestroyed()) {
        sender.send('scheduler:event', payload)
      }
    }

    const onTaskCreated = (task: unknown) => {
      sendEvent({ type: 'task:created', timestamp: Date.now(), taskId: extractTaskId(task) })
    }
    const onTaskCancelled = (task: unknown) => {
      sendEvent({ type: 'task:cancelled', timestamp: Date.now(), taskId: extractTaskId(task) })
    }
    const onTaskPaused = (task: unknown) => {
      sendEvent({ type: 'task:paused', timestamp: Date.now(), taskId: extractTaskId(task) })
    }
    const onTaskResumed = (task: unknown) => {
      sendEvent({ type: 'task:resumed', timestamp: Date.now(), taskId: extractTaskId(task) })
    }
    const onTaskSuccess = (task: unknown) => {
      sendEvent({ type: 'task:success', timestamp: Date.now(), taskId: extractTaskId(task) })
    }
    const onTaskFailed = (task: unknown) => {
      sendEvent({ type: 'task:failed', timestamp: Date.now(), taskId: extractTaskId(task) })
    }
    const onTasksDeleted = (payload?: { taskIds?: string[]; deletedCount?: number }) => {
      sendEvent({
        type: 'tasks:deleted',
        timestamp: Date.now(),
        deletedCount: payload?.deletedCount,
        taskIds: payload?.taskIds
      })
    }
    const onTasksCleaned = (payload?: { deletedCount?: number }) => {
      sendEvent({
        type: 'tasks:cleaned',
        timestamp: Date.now(),
        deletedCount: payload?.deletedCount
      })
    }

    scheduler.on('task:created', onTaskCreated)
    scheduler.on('task:cancelled', onTaskCancelled)
    scheduler.on('task:paused', onTaskPaused)
    scheduler.on('task:resumed', onTaskResumed)
    scheduler.on('task:success', onTaskSuccess)
    scheduler.on('task:failed', onTaskFailed)
    scheduler.on('tasks:deleted', onTasksDeleted)
    scheduler.on('tasks:cleaned', onTasksCleaned)

    const cleanup = () => {
      scheduler.off('task:created', onTaskCreated)
      scheduler.off('task:cancelled', onTaskCancelled)
      scheduler.off('task:paused', onTaskPaused)
      scheduler.off('task:resumed', onTaskResumed)
      scheduler.off('task:success', onTaskSuccess)
      scheduler.off('task:failed', onTaskFailed)
      scheduler.off('tasks:deleted', onTasksDeleted)
      scheduler.off('tasks:cleaned', onTasksCleaned)
    }

    const destroyHandler = () => {
      clearSchedulerSubscription(webContentsId)
    }
    sender.once('destroyed', destroyHandler)
    schedulerSubscriptions.set(webContentsId, { sender, cleanup, destroyHandler })
  }

  // 列出任务
  ipcMain.handle('scheduler:listTasks', async (_, filter?: { pluginId?: string; status?: string; type?: string; limit?: number; offset?: number }) => {
    try {
      const scheduler = getScheduler()
      return await scheduler.listTasks(filter)
    } catch (err) {
      console.error('Failed to list tasks:', err)
      throw err
    }
  })

  // 获取任务总数
  ipcMain.handle('scheduler:getTaskCount', async (_, filter?: { pluginId?: string; status?: string; type?: string }) => {
    try {
      const scheduler = getScheduler()
      return await scheduler.getTaskCount(filter)
    } catch (err) {
      console.error('Failed to get task count:', err)
      throw err
    }
  })

  // 批量删除任务
  ipcMain.handle('scheduler:deleteTasks', async (_, taskIds: string[]) => {
    try {
      const scheduler = getScheduler()
      const deletedCount = await scheduler.deleteTasks(taskIds)
      return { success: true, deletedCount }
    } catch (err) {
      console.error('Failed to delete tasks:', err)
      throw err
    }
  })

  // 清除任务记录
  ipcMain.handle('scheduler:cleanupTasks', async (_, olderThan?: number) => {
    try {
      const scheduler = getScheduler()
      const deletedCount = await scheduler.cleanupTasks(olderThan)
      return { success: true, deletedCount }
    } catch (err) {
      console.error('Failed to cleanup tasks:', err)
      throw err
    }
  })

  // 获取单个任务
  ipcMain.handle('scheduler:getTask', async (_, taskId: string) => {
    try {
      const scheduler = getScheduler()
      return await scheduler.getTask(taskId)
    } catch (err) {
      console.error('Failed to get task:', err)
      throw err
    }
  })

  // 创建任务
  ipcMain.handle('scheduler:schedule', async (_, task: any) => {
    try {
      const scheduler = getScheduler()
      return await scheduler.createTask(task)
    } catch (err) {
      console.error('Failed to schedule task:', err)
      throw err
    }
  })

  // 取消任务
  ipcMain.handle('scheduler:cancelTask', async (_, taskId: string) => {
    try {
      const scheduler = getScheduler()
      await scheduler.cancelTask(taskId)
      return { success: true }
    } catch (err) {
      console.error('Failed to cancel task:', err)
      throw err
    }
  })

  // 暂停任务
  ipcMain.handle('scheduler:pauseTask', async (_, taskId: string) => {
    try {
      const scheduler = getScheduler()
      await scheduler.pauseTask(taskId)
      return { success: true }
    } catch (err) {
      console.error('Failed to pause task:', err)
      throw err
    }
  })

  // 恢复任务
  ipcMain.handle('scheduler:resumeTask', async (_, taskId: string) => {
    try {
      const scheduler = getScheduler()
      await scheduler.resumeTask(taskId)
      return { success: true }
    } catch (err) {
      console.error('Failed to resume task:', err)
      throw err
    }
  })

  // 获取执行历史
  ipcMain.handle('scheduler:getExecutions', async (_, taskId: string, limit?: number) => {
    try {
      const scheduler = getScheduler()
      return await scheduler.getExecutions(taskId, limit)
    } catch (err) {
      console.error('Failed to get executions:', err)
      throw err
    }
  })

  // 验证 Cron 表达式
  ipcMain.handle('scheduler:validateCron', async (_, expression: string) => {
    try {
      const scheduler = getScheduler()
      return scheduler.validateCron(expression)
    } catch (err) {
      console.error('Failed to validate cron:', err)
      throw err
    }
  })

  // 获取下次执行时间
  ipcMain.handle('scheduler:getNextCronTime', async (_, expression: string, after?: Date) => {
    try {
      const scheduler = getScheduler()
      return scheduler.getNextCronTime(expression, after)
    } catch (err) {
      console.error('Failed to get next cron time:', err)
      throw err
    }
  })

  // 描述 Cron 表达式
  ipcMain.handle('scheduler:describeCron', async (_, expression: string) => {
    try {
      const scheduler = getScheduler()
      return scheduler.describeCron(expression)
    } catch (err) {
      console.error('Failed to describe cron:', err)
      throw err
    }
  })

  // 订阅任务调度事件
  ipcMain.handle('scheduler:subscribe', (event) => {
    try {
      subscribeSchedulerEvents(event.sender)
      return { success: true }
    } catch (err) {
      console.error('Failed to subscribe scheduler events:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 取消订阅任务调度事件
  ipcMain.handle('scheduler:unsubscribe', (event) => {
    try {
      clearSchedulerSubscription(event.sender.id)
      return { success: true }
    } catch (err) {
      console.error('Failed to unsubscribe scheduler events:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
