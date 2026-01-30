/**
 * Task Scheduler IPC Handlers
 */

import { ipcMain } from 'electron'
import type { PluginManager } from '../plugin/manager'

export function registerSchedulerHandlers(pluginManager: PluginManager) {
  const getScheduler = () => {
    return (pluginManager as any).taskScheduler
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
}
