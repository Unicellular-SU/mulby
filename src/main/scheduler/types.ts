/**
 * Task Scheduler Types
 * 任务调度器类型定义
 */

// 任务类型
export type TaskType = 'once' | 'repeat' | 'delay'

// 任务状态
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

// 任务输入
export interface TaskInput {
  pluginId: string           // 插件 ID
  name: string               // 任务名称
  description?: string       // 任务描述
  type: TaskType             // 任务类型

  // 时间配置（根据 type 不同，使用不同字段）
  time?: number              // 一次性任务：执行时间戳
  cron?: string              // 重复任务：cron 表达式
  delay?: number             // 延迟任务：延迟毫秒数

  // 执行配置
  callback: string           // 回调方法名（插件中的方法）
  payload?: unknown          // 传递给回调的数据

  // 可选配置
  priority?: number          // 优先级（0-10，数字越大优先级越高，默认 5）
  timezone?: string          // 时区（默认系统时区）
  maxRetries?: number        // 最大重试次数（默认 0）
  retryDelay?: number        // 重试延迟（毫秒，默认 60000）
  timeout?: number           // 执行超时（毫秒，默认 30000）

  // 重复任务配置
  endTime?: number           // 结束时间（重复任务）
  maxExecutions?: number     // 最大执行次数（重复任务）
}

// 任务对象
export interface Task extends TaskInput {
  id: string                 // 任务 ID
  status: TaskStatus         // 任务状态
  createdAt: number          // 创建时间
  updatedAt: number          // 更新时间
  nextRunTime?: number       // 下次执行时间
  lastRunTime?: number       // 上次执行时间
  executionCount: number     // 已执行次数
  failureCount: number       // 失败次数
  lastError?: string         // 最后一次错误信息
}

// 任务执行记录
export interface TaskExecution {
  id: string                 // 执行 ID
  taskId: string             // 任务 ID
  startTime: number          // 开始时间
  endTime?: number           // 结束时间
  status: 'success' | 'failed' | 'timeout'
  result?: unknown           // 执行结果
  error?: string             // 错误信息
  duration?: number          // 执行时长（毫秒）
}

// 任务过滤器
export interface TaskFilter {
  pluginId?: string          // 按插件过滤
  status?: TaskStatus        // 按状态过滤
  type?: TaskType            // 按类型过滤
  limit?: number             // 限制数量
  offset?: number            // 偏移量
}

// Cron 调度配置
export interface CronSchedule {
  expression: string
  timezone?: string
}
