import { useCallback, useEffect, useState } from 'react'
import type { Task, TaskExecution } from '../../shared/types/task'

interface TaskSchedulerViewProps {
  onBack: () => void
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = timestamp - now.getTime()

  if (diff < 0) {
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天后`
  if (hours > 0) return `${hours}小时后`
  if (minutes > 0) return `${minutes}分钟后`
  return `${seconds}秒后`
}

function formatDuration(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}

function TaskTypeTag({ type }: { type: Task['type'] }) {
  const typeMap = {
    once: { label: '一次性', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400' },
    repeat: { label: '重复', color: 'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400' },
    delay: { label: '延迟', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400' }
  }
  const config = typeMap[type]
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  )
}

function TaskStatusBadge({ status }: { status: Task['status'] }) {
  const statusMap = {
    pending: { label: '等待中', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
    running: { label: '运行中', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400' },
    paused: { label: '已暂停', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400' },
    completed: { label: '已完成', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' },
    failed: { label: '失败', color: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400' },
    cancelled: { label: '已取消', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' }
  }
  const config = statusMap[status]
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  )
}

export default function TaskSchedulerView({ onBack }: TaskSchedulerViewProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [, setClockTick] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'failed'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const pageSize = 20

  const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white/80 p-6  dark:border-slate-800/80 dark:bg-slate-900/70'
  const cardClassTight = 'rounded-[24px] border border-slate-200/80 bg-white/80 p-5  dark:border-slate-800/80 dark:bg-slate-900/70'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed'
  const dangerButtonClass = 'rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 transition hover:border-red-300 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400 dark:hover:bg-red-900/30'

  const refreshTasks = useCallback(async () => {
    try {
      const statusFilter =
        filter === 'pending' ? 'pending'
          : filter === 'completed' ? 'completed'
            : filter === 'failed' ? 'failed'
              : undefined
      const [list, count] = await Promise.all([
        window.mulby.scheduler.listTasks({
          status: statusFilter,
          limit: pageSize,
          offset: (currentPage - 1) * pageSize
        }),
        window.mulby.scheduler.getTaskCount({
          status: statusFilter
        })
      ])
      setTasks(list)
      setTotalCount(count)
      setSelectedTaskIds((prev) => {
        if (prev.size === 0) return prev
        const currentIds = new Set(list.map((task) => task.id))
        const next = new Set(Array.from(prev).filter((taskId) => currentIds.has(taskId)))
        return next.size === prev.size ? prev : next
      })
    } catch (err) {
      console.error('Failed to list tasks:', err)
    }
  }, [currentPage, filter])

  const refreshTaskDetails = useCallback(async (taskId: string) => {
    try {
      const [task, execs] = await Promise.all([
        window.mulby.scheduler.getTask(taskId),
        window.mulby.scheduler.getExecutions(taskId, 20)
      ])
      setSelectedTask(task)
      setExecutions(execs)
    } catch (err) {
      console.error('Failed to refresh task details:', err)
    }
  }, [])

  useEffect(() => {
    void refreshTasks()
  }, [refreshTasks])

  useEffect(() => {
    const timer = setInterval(() => {
      setClockTick((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!autoRefresh) return

    let fallbackTimer: ReturnType<typeof setInterval> | null = null
    const startFallback = () => {
      if (fallbackTimer) return
      fallbackTimer = setInterval(() => {
        void refreshTasks()
      }, 15000)
    }

    const unsubscribeEvent = window.mulby.scheduler.onEvent((event) => {
      void refreshTasks()
      if (selectedTask?.id && (!event.taskId || event.taskId === selectedTask.id)) {
        void refreshTaskDetails(selectedTask.id)
      }
    })

    void window.mulby.scheduler.subscribe()
      .then((result) => {
        if (!result?.success) {
          startFallback()
        }
      })
      .catch(() => {
        startFallback()
      })

    const recoveryTimer = setInterval(() => {
      void refreshTasks()
    }, 30000)

    const handleWindowFocus = () => {
      void refreshTasks()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshTasks()
      }
    }
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      unsubscribeEvent()
      void window.mulby.scheduler.unsubscribe()
      if (fallbackTimer) clearInterval(fallbackTimer)
      clearInterval(recoveryTimer)
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [autoRefresh, refreshTasks, refreshTaskDetails, selectedTask?.id])

  const handleCancel = async (taskId: string) => {
    const { response } = await window.mulby.dialog.showMessageBox({
      type: 'question',
      title: '取消任务',
      message: '确定要取消此任务吗？',
      buttons: ['取消', '确定'],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return

    try {
      await window.mulby.scheduler.cancelTask(taskId)
      window.mulby.notification.show('任务已取消', 'success')
      await refreshTasks()
    } catch {
      window.mulby.notification.show('取消失败', 'error')
    }
  }

  const handlePause = async (taskId: string) => {
    try {
      await window.mulby.scheduler.pauseTask(taskId)
      window.mulby.notification.show('任务已暂停', 'success')
      await refreshTasks()
    } catch {
      window.mulby.notification.show('暂停失败', 'error')
    }
  }

  const handleResume = async (taskId: string) => {
    try {
      await window.mulby.scheduler.resumeTask(taskId)
      window.mulby.notification.show('任务已恢复', 'success')
      await refreshTasks()
    } catch {
      window.mulby.notification.show('恢复失败', 'error')
    }
  }

  const handleViewDetails = async (task: Task) => {
    setSelectedTask(task)
    await refreshTaskDetails(task.id)
  }

  const handleBatchDelete = async () => {
    if (selectedTaskIds.size === 0) {
      window.mulby.notification.show('请先选择要删除的任务', 'warning')
      return
    }

    const { response } = await window.mulby.dialog.showMessageBox({
      type: 'question',
      title: '批量删除',
      message: `确定要删除选中的 ${selectedTaskIds.size} 个任务吗？`,
      buttons: ['取消', '删除'],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return

    try {
      const result = await window.mulby.scheduler.deleteTasks(Array.from(selectedTaskIds))
      window.mulby.notification.show(`已删除 ${result.deletedCount} 个任务`, 'success')
      setSelectedTaskIds(new Set())
      await refreshTasks()
    } catch {
      window.mulby.notification.show('批量删除失败', 'error')
    }
  }

  const handleCleanup = async () => {
    const { response } = await window.mulby.dialog.showMessageBox({
      type: 'question',
      title: '清除记录',
      message: '确定要清除所有已完成、失败和已取消的任务吗？',
      detail: '保留最近7天的记录',
      buttons: ['取消', '清除'],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return

    try {
      const result = await window.mulby.scheduler.cleanupTasks()
      window.mulby.notification.show(`已清除 ${result.deletedCount} 个任务`, 'success')
      await refreshTasks()
    } catch {
      window.mulby.notification.show('清除失败', 'error')
    }
  }

  const toggleSelectTask = (taskId: string) => {
    const newSelected = new Set(selectedTaskIds)
    if (newSelected.has(taskId)) {
      newSelected.delete(taskId)
    } else {
      newSelected.add(taskId)
    }
    setSelectedTaskIds(newSelected)
  }

  const toggleSelectAll = () => {
    if (selectedTaskIds.size === tasks.length) {
      setSelectedTaskIds(new Set())
    } else {
      setSelectedTaskIds(new Set(tasks.map(t => t.id)))
    }
  }

  const filteredTasks = tasks

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-purple-200/40 blur-[120px] dark:bg-purple-500/20" />
        <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-400/10" />
        <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-indigo-200/30 blur-[120px] dark:bg-indigo-500/10" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col">
        {/* 头部 */}
        <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white/70 px-6 py-4  dark:border-slate-800/80 dark:bg-slate-900/60">
          <button
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
            title="返回"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Task Scheduler</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">任务调度器</div>
          </div>
          {selectedTaskIds.size > 0 && (
            <button
              className={`${dangerButtonClass} no-drag`}
              onClick={handleBatchDelete}
            >
              删除选中 ({selectedTaskIds.size})
            </button>
          )}
          <button
            className={`${dangerButtonClass} no-drag`}
            onClick={handleCleanup}
          >
            清除记录
          </button>
          <button
            className={`${actionButtonClass} flex items-center gap-1.5 no-drag`}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <div className={`h-1.5 w-1.5 rounded-full transition-colors ${autoRefresh ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            自动刷新
          </button>
          <button className={`${actionButtonClass} no-drag`} onClick={refreshTasks}>
            刷新
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 min-h-0 overflow-auto no-drag">
          <div className="mx-auto max-w-6xl px-6 pb-16 pt-8">
            {/* 统计卡片 */}
            <div className={`${cardClass} space-y-4`}>
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">任务概览</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {filter === 'all' ? `共有 ${totalCount} 个任务` : `筛选结果：${totalCount} 个任务`}
                  {totalCount > 0 && ` · 第 ${currentPage}/${totalPages} 页`}
                </div>
              </div>
            </div>

            {/* 过滤器 */}
            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-2">
                {(['all', 'pending', 'completed', 'failed'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => {
                      setFilter(f)
                      setCurrentPage(1)
                      setSelectedTaskIds(new Set())
                    }}
                    className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                      filter === f
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {f === 'all' && '全部'}
                    {f === 'pending' && '进行中'}
                    {f === 'completed' && '已完成'}
                    {f === 'failed' && '失败'}
                  </button>
                ))}
              </div>
              {tasks.length > 0 && (
                <button
                  className={actionButtonClass}
                  onClick={toggleSelectAll}
                >
                  {selectedTaskIds.size === tasks.length ? '取消全选' : '全选'}
                </button>
              )}
            </div>

            {/* 任务列表 */}
            {filteredTasks.length === 0 ? (
              <div className={`${cardClass} mt-6 text-center`}>
                <div className="py-8">
                  <svg className="mx-auto h-16 w-16 text-slate-300 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                    {filter === 'all' ? '暂无任务' : '暂无符合条件的任务'}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-6 space-y-3">
                {filteredTasks.map(task => (
                  <div key={task.id} className={cardClassTight}>
                    <div className="flex items-start gap-4">
                      <input
                        type="checkbox"
                        checked={selectedTaskIds.has(task.id)}
                        onChange={() => toggleSelectTask(task.id)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="font-medium text-slate-900 dark:text-white truncate">
                            {task.name}
                          </div>
                          <TaskTypeTag type={task.type} />
                          <TaskStatusBadge status={task.status} />
                        </div>

                        {task.description && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                            {task.description}
                          </div>
                        )}

                        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                          <div className="flex items-center gap-1">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                            </svg>
                            {task.pluginId}
                          </div>
                          {task.nextRunTime && task.status === 'pending' && (
                            <div className="flex items-center gap-1">
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatTime(task.nextRunTime)}
                            </div>
                          )}
                          {task.cron && (
                            <div className="flex items-center gap-1">
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              {task.cron}
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            执行 {task.executionCount} 次
                          </div>
                          {task.failureCount > 0 && (
                            <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              失败 {task.failureCount} 次
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          className={actionButtonClass}
                          onClick={() => handleViewDetails(task)}
                        >
                          详情
                        </button>
                        {task.status === 'pending' && (
                          <button
                            className={actionButtonClass}
                            onClick={() => handlePause(task.id)}
                          >
                            暂停
                          </button>
                        )}
                        {task.status === 'paused' && (
                          <button
                            className={actionButtonClass}
                            onClick={() => handleResume(task.id)}
                          >
                            恢复
                          </button>
                        )}
                        {(task.status === 'pending' || task.status === 'paused') && (
                          <button
                            className={dangerButtonClass}
                            onClick={() => handleCancel(task.id)}
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  ))}
                </div>

                {/* 分页控制 */}
                {totalPages > 1 && (
                  <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    className={actionButtonClass}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    上一页
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number
                      if (totalPages <= 5) {
                        pageNum = i + 1
                      } else if (currentPage <= 3) {
                        pageNum = i + 1
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i
                      } else {
                        pageNum = currentPage - 2 + i
                      }
                      return (
                        <button
                          key={pageNum}
                          className={`h-8 w-8 rounded-full text-xs font-medium transition ${
                            currentPage === pageNum
                              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                              : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                          onClick={() => setCurrentPage(pageNum)}
                        >
                          {pageNum}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    className={actionButtonClass}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    下一页
                  </button>
                </div>
              )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 任务详情弹窗 */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 -sm"
          onClick={() => setSelectedTask(null)}
        >
          <div
            className="mx-4 w-full max-w-3xl max-h-[80vh] overflow-auto rounded-[32px] border border-slate-200/80 bg-white p-8 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-6 flex items-start justify-between">
              <div>
                <div className="text-xl font-semibold text-slate-900 dark:text-white">
                  {selectedTask.name}
                </div>
                <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  任务 ID: {selectedTask.id}
                </div>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-6">
              {/* 基本信息 */}
              <div>
                <div className="mb-3 text-sm font-medium text-slate-900 dark:text-white">基本信息</div>
                <div className="space-y-2 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-800/50">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">类型</span>
                    <TaskTypeTag type={selectedTask.type} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">状态</span>
                    <TaskStatusBadge status={selectedTask.status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">插件</span>
                    <span className="text-slate-900 dark:text-white">{selectedTask.pluginId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">回调方法</span>
                    <span className="text-slate-900 dark:text-white">{selectedTask.callback}</span>
                  </div>
                  {selectedTask.cron && (
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Cron 表达式</span>
                      <span className="font-mono text-slate-900 dark:text-white">{selectedTask.cron}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">执行次数</span>
                    <span className="text-slate-900 dark:text-white">{selectedTask.executionCount}</span>
                  </div>
                  {selectedTask.failureCount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-slate-400">失败次数</span>
                      <span className="text-red-600 dark:text-red-400">{selectedTask.failureCount}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 执行历史 */}
              <div>
                <div className="mb-3 text-sm font-medium text-slate-900 dark:text-white">
                  执行历史 ({executions.length})
                </div>
                {executions.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                    暂无执行记录
                  </div>
                ) : (
                  <div className="space-y-2">
                    {executions.map(exec => (
                      <div
                        key={exec.id}
                        className="rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-800/50"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-slate-500 dark:text-slate-400">
                            {new Date(exec.startTime).toLocaleString('zh-CN')}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            exec.status === 'success'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                              : exec.status === 'timeout'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400'
                          }`}>
                            {exec.status === 'success' ? '成功' : exec.status === 'timeout' ? '超时' : '失败'}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                          <span>耗时: {formatDuration(exec.duration)}</span>
                          {exec.error && (
                            <span className="text-red-600 dark:text-red-400">错误: {exec.error}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
