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
  ipcMain.handle('scheduler:listTasks', async (_, filter?: { pluginId?: string; status?: string; type?: string }) => {
    try {
      const scheduler = getScheduler()
      return await scheduler.listTasks(filter)
    } catch (err) {
      console.error('Failed to list tasks:', err)
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
}
