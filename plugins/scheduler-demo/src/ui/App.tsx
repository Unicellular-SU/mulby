import { useEffect, useState } from 'react'
import { Clock, Play, Pause, Trash2, RefreshCw, Plus } from 'lucide-react'
import { useMulby } from './hooks/useMulby'

interface Task {
  id: string
  pluginId: string
  name: string
  type: 'once' | 'repeat' | 'delay'
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  callback: string
  payload?: any
  nextRunTime?: number
  lastRunTime?: number
  executionCount: number
  failureCount: number
  createdAt: number
  updatedAt: number
  cron?: string
  time?: number
  delay?: number
}

interface TaskExecution {
  id: string
  taskId: string
  startTime: number
  endTime?: number
  status: 'success' | 'failed' | 'timeout'
  result?: any
  error?: string
  duration?: number
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [taskType, setTaskType] = useState<'once' | 'repeat' | 'delay'>('delay')
  const [taskMessage, setTaskMessage] = useState('')
  const [taskDelay, setTaskDelay] = useState('5000')
  const [taskDateTime, setTaskDateTime] = useState('')
  const [taskCron, setTaskCron] = useState('0 */1 * * * *')
  const [cronDescription, setCronDescription] = useState('')
  const { notification, scheduler, host } = useMulby('scheduler-demo')

  // 加载任务列表
  const loadTasks = async () => {
    try {
      setLoading(true)
      const result = await scheduler.list()
      setTasks(result || [])
    } catch (err) {
      console.error('Failed to load tasks:', err)
      notification.show('加载任务失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  // 加载任务执行历史
  const loadExecutions = async (taskId: string) => {
    try {
      const result = await scheduler.getExecutions(taskId, 10)
      setExecutions(result || [])
    } catch (err) {
      console.error('Failed to load executions:', err)
    }
  }

  // 测试调用 host 方法
  const testHostMethod = async () => {
    try {
      const result = await host.call('testMethod', '这是来自UI的测试消息')
      console.log('Host method result:', result)
      notification.show(`Host返回: ${result.data.message}`)
    } catch (err: any) {
      console.error('Failed to call host method:', err)
      notification.show(err.message || '调用失败', 'error')
    }
  }

  // 测试直接导出的方法
  const testDirectMethod = async () => {
    try {
      const result = await host.call('directMethod', '测试直接导出')
      console.log('Direct method result:', result)
      notification.show(`直接方法返回: ${result.data.message}`)
    } catch (err: any) {
      console.error('Failed to call direct method:', err)
      notification.show(err.message || '调用失败', 'error')
    }
  }

  // 测试 api 对象的方法
  const testApiMethod = async () => {
    try {
      const result = await host.call('customMethod', { test: 'data', value: 123 })
      console.log('API method result:', result)
      notification.show(`API方法返回: ${JSON.stringify(result.data.received)}`)
    } catch (err: any) {
      console.error('Failed to call api method:', err)
      notification.show(err.message || '调用失败', 'error')
    }
  }

  // 创建任务
  const createTask = async () => {
    try {
      if (!taskMessage.trim()) {
        notification.show('请输入任务消息', 'error')
        return
      }

      if (taskType === 'once') {
        // 一次性任务：使用日期时间选择器
        if (!taskDateTime) {
          notification.show('请选择执行时间', 'error')
          return
        }
        const time = new Date(taskDateTime).getTime()
        if (isNaN(time) || time <= Date.now()) {
          notification.show('请选择未来的时间', 'error')
          return
        }
        await scheduler.schedule({
          pluginId: 'scheduler-demo',
          name: '一次性任务',
          type: 'once',
          time: time,
          callback: 'onOnceTask',
          payload: { message: taskMessage }
        })
      } else if (taskType === 'delay') {
        // 延迟任务：使用延迟毫秒数
        const delay = parseInt(taskDelay)
        if (isNaN(delay) || delay <= 0) {
          notification.show('请输入有效的延迟时间（毫秒）', 'error')
          return
        }
        await scheduler.schedule({
          pluginId: 'scheduler-demo',
          name: '延迟任务',
          type: 'delay',
          delay: delay,
          callback: 'onDelayTask',
          payload: { message: taskMessage }
        })
      } else if (taskType === 'repeat') {
        const isValid = await scheduler.validateCron(taskCron)
        if (!isValid) {
          notification.show('无效的 Cron 表达式', 'error')
          return
        }
        await scheduler.schedule({
          pluginId: 'scheduler-demo',
          name: '重复任务',
          type: 'repeat',
          cron: taskCron,
          callback: 'onScheduledTask',
          payload: { message: taskMessage }
        })
      }

      notification.show('任务创建成功')
      setShowCreateModal(false)
      setTaskMessage('')
      setTaskDateTime('')
      await loadTasks()
    } catch (err: any) {
      console.error('Failed to create task:', err)
      notification.show(err.message || '创建任务失败', 'error')
    }
  }

  // 取消任务
  const cancelTask = async (taskId: string) => {
    try {
      await scheduler.cancel(taskId)
      notification.show('任务已取消')
      await loadTasks()
      if (selectedTask?.id === taskId) {
        setSelectedTask(null)
      }
    } catch (err) {
      console.error('Failed to cancel task:', err)
      notification.show('取消任务失败', 'error')
    }
  }

  // 暂停任务
  const pauseTask = async (taskId: string) => {
    try {
      await scheduler.pause(taskId)
      notification.show('任务已暂停')
      await loadTasks()
    } catch (err) {
      console.error('Failed to pause task:', err)
      notification.show('暂停任务失败', 'error')
    }
  }

  // 恢复任务
  const resumeTask = async (taskId: string) => {
    try {
      await scheduler.resume(taskId)
      notification.show('任务已恢复')
      await loadTasks()
    } catch (err) {
      console.error('Failed to resume task:', err)
      notification.show('恢复任务失败', 'error')
    }
  }

  // 验证并描述 Cron 表达式
  const validateAndDescribeCron = async (expression: string) => {
    try {
      const isValid = await scheduler.validateCron(expression)
      if (isValid) {
        const desc = await scheduler.describeCron(expression)
        setCronDescription(desc)
      } else {
        setCronDescription('无效的 Cron 表达式')
      }
    } catch (err) {
      setCronDescription('验证失败')
    }
  }

  useEffect(() => {
    loadTasks()
    const interval = setInterval(loadTasks, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedTask) {
      loadExecutions(selectedTask.id)
    }
  }, [selectedTask])

  useEffect(() => {
    if (taskType === 'repeat') {
      validateAndDescribeCron(taskCron)
    }
  }, [taskCron, taskType])

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '-'
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'text-blue-600 dark:text-blue-400'
      case 'running': return 'text-green-600 dark:text-green-400'
      case 'paused': return 'text-yellow-600 dark:text-yellow-400'
      case 'completed': return 'text-gray-600 dark:text-gray-400'
      case 'failed': return 'text-red-600 dark:text-red-400'
      case 'cancelled': return 'text-gray-600 dark:text-gray-400'
      default: return 'text-gray-600 dark:text-gray-400'
    }
  }

  const getStatusText = (status: string) => {
    const map: Record<string, string> = {
      pending: '等待中',
      running: '运行中',
      paused: '已暂停',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消'
    }
    return map[status] || status
  }

  const getTypeText = (type: string) => {
    const map: Record<string, string> = {
      once: '一次性',
      repeat: '重复',
      delay: '延迟'
    }
    return map[type] || type
  }

  return (
    <div className="app">
      <div className="container max-w-6xl">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">任务调度演示</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              共 {tasks.length} 个任务
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={testHostMethod}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              测试Host
            </button>
            <button
              onClick={testDirectMethod}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              测试直接导出
            </button>
            <button
              onClick={testApiMethod}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              测试API对象
            </button>
            <button
              onClick={loadTasks}
              disabled={loading}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={16} />
              创建任务
            </button>
          </div>
        </div>

        {/* 任务列表 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 左侧：任务列表 */}
          <div className="space-y-3">
            {tasks.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                暂无任务
              </div>
            ) : (
              tasks.map(task => (
                <div
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedTask?.id === task.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Clock size={16} className="text-gray-400" />
                        <span className="font-medium text-gray-900 dark:text-white">
                          {task.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                        <span className={getStatusColor(task.status)}>
                          {getStatusText(task.status)}
                        </span>
                        <span>·</span>
                        <span>{getTypeText(task.type)}</span>
                        <span>·</span>
                        <span>执行 {task.executionCount} 次</span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {task.status === 'pending' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); pauseTask(task.id) }}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                          title="暂停"
                        >
                          <Pause size={16} />
                        </button>
                      )}
                      {task.status === 'paused' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); resumeTask(task.id) }}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                          title="恢复"
                        >
                          <Play size={16} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelTask(task.id) }}
                        className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 text-red-600 rounded"
                        title="取消"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {task.nextRunTime && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      下次执行: {formatTime(task.nextRunTime)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* 右侧：任务详情 */}
          <div className="space-y-4">
            {selectedTask ? (
              <>
                <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <h3 className="font-medium text-gray-900 dark:text-white mb-3">任务详情</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">任务 ID:</span>
                      <span className="text-gray-900 dark:text-white font-mono text-xs">
                        {selectedTask.id.slice(0, 8)}...
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">类型:</span>
                      <span className="text-gray-900 dark:text-white">{getTypeText(selectedTask.type)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">状态:</span>
                      <span className={getStatusColor(selectedTask.status)}>
                        {getStatusText(selectedTask.status)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">创建时间:</span>
                      <span className="text-gray-900 dark:text-white">{formatTime(selectedTask.createdAt)}</span>
                    </div>
                    {selectedTask.nextRunTime && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">下次执行:</span>
                        <span className="text-gray-900 dark:text-white">{formatTime(selectedTask.nextRunTime)}</span>
                      </div>
                    )}
                    {selectedTask.lastRunTime && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">上次执行:</span>
                        <span className="text-gray-900 dark:text-white">{formatTime(selectedTask.lastRunTime)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">执行次数:</span>
                      <span className="text-gray-900 dark:text-white">{selectedTask.executionCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">失败次数:</span>
                      <span className="text-gray-900 dark:text-white">{selectedTask.failureCount}</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <h3 className="font-medium text-gray-900 dark:text-white mb-3">执行历史</h3>
                  <div className="space-y-2">
                    {executions.length === 0 ? (
                      <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
                        暂无执行记录
                      </div>
                    ) : (
                      executions.map(exec => (
                        <div
                          key={exec.id}
                          className="p-3 rounded bg-gray-50 dark:bg-gray-800 text-sm"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className={
                              exec.status === 'success' ? 'text-green-600 dark:text-green-400' :
                                exec.status === 'failed' ? 'text-red-600 dark:text-red-400' :
                                  'text-yellow-600 dark:text-yellow-400'
                            }>
                              {exec.status === 'success' ? '成功' : exec.status === 'failed' ? '失败' : '超时'}
                            </span>
                            <span className="text-gray-500 dark:text-gray-400 text-xs">
                              {formatTime(exec.startTime)}
                            </span>
                          </div>
                          {exec.duration && (
                            <div className="text-gray-600 dark:text-gray-400 text-xs">
                              耗时: {exec.duration}ms
                            </div>
                          )}
                          {exec.error && (
                            <div className="text-red-600 dark:text-red-400 text-xs mt-1">
                              {exec.error}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                选择一个任务查看详情
              </div>
            )}
          </div>
        </div>

        {/* 创建任务模态框 */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">创建任务</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    任务类型
                  </label>
                  <select
                    value={taskType}
                    onChange={(e) => setTaskType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="delay">延迟任务</option>
                    <option value="once">一次性任务</option>
                    <option value="repeat">重复任务</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    任务消息
                  </label>
                  <input
                    type="text"
                    value={taskMessage}
                    onChange={(e) => setTaskMessage(e.target.value)}
                    placeholder="输入任务消息..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {taskType === 'once' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      执行时间
                    </label>
                    <input
                      type="datetime-local"
                      value={taskDateTime}
                      onChange={(e) => setTaskDateTime(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                )}

                {taskType === 'delay' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      延迟时间（毫秒）
                    </label>
                    <input
                      type="number"
                      value={taskDelay}
                      onChange={(e) => setTaskDelay(e.target.value)}
                      placeholder="5000"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                )}

                {taskType === 'repeat' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Cron 表达式
                    </label>
                    <input
                      type="text"
                      value={taskCron}
                      onChange={(e) => setTaskCron(e.target.value)}
                      placeholder="0 */1 * * * *"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                    />
                    {cronDescription && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {cronDescription}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 btn-secondary"
                >
                  取消
                </button>
                <button
                  onClick={createTask}
                  className="flex-1 btn-primary"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
