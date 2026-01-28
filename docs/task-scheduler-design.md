# 任务调度器设计方案

## 1. 概述

### 1.1 目标

为 InTools 提供一个强大、可靠的任务调度系统，支持插件创建定时任务、周期任务和延迟任务，解决插件需要长期后台运行才能实现定时功能的问题。

### 1.2 核心特性

- ✅ **多种任务类型**：一次性任务、重复任务、延迟任务
- ✅ **Cron 表达式支持**：灵活的时间调度配置
- ✅ **持久化存储**：任务数据持久化，应用重启后自动恢复
- ✅ **系统级集成**：可选的操作系统定时任务集成（macOS/Windows/Linux）
- ✅ **可靠性保证**：错误重试、执行历史、任务状态跟踪
- ✅ **高性能**：高效的任务队列和调度算法
- ✅ **插件友好**：简单易用的 API，与现有插件系统无缝集成

### 1.3 使用场景

- **定时提醒**：在指定时间提醒用户某件事
- **周期任务**：每天、每周、每月执行的重复任务
- **数据同步**：定期同步数据、备份文件
- **监控告警**：定期检查系统状态并告警
- **自动化工作流**：定时执行自动化脚本
- **健康提醒**：定时提醒用户休息、喝水等

### 1.4 设计原则

- **可靠性优先**：任务不能因为应用重启而丢失
- **资源高效**：不需要插件一直在后台运行
- **简单易用**：API 设计直观，降低插件开发门槛
- **跨平台**：支持 macOS、Windows、Linux
- **可扩展**：易于添加新的任务类型和触发器
- **可观测**：提供任务执行历史和状态查询

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Plugin Layer                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Plugin A │  │ Plugin B │  │ Plugin C │  │ Plugin D │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │           │
│       └─────────────┴─────────────┴─────────────┘           │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           │ api.scheduler.*
┌──────────────────────────┼───────────────────────────────────┐
│                          ▼                                   │
│                  ┌──────────────────┐                        │
│                  │  Scheduler API   │                        │
│                  └────────┬─────────┘                        │
│                           │                                   │
│         ┌─────────────────┼─────────────────┐                │
│         │                 │                 │                │
│         ▼                 ▼                 ▼                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Task      │  │   Task      │  │   Cron      │         │
│  │  Scheduler  │  │   Store     │  │   Parser    │         │
│  │             │  │             │  │             │         │
│  │ - 任务队列  │  │ - 持久化    │  │ - 表达式    │         │
│  │ - 调度算法  │  │ - 恢复      │  │ - 下次时间  │         │
│  │ - 执行器    │  │ - 查询      │  │ - 验证      │         │
│  └──────┬──────┘  └─────────────┘  └─────────────┘         │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────┐                                             │
│  │   Plugin    │                                             │
│  │   Manager   │                                             │
│  │             │                                             │
│  │ - 触发插件  │                                             │
│  │ - 执行回调  │                                             │
│  └─────────────┘                                             │
│                                                               │
│                    Task Scheduler Core                       │
└───────────────────────────────────────────────────────────────┘
                           │
                           │ (可选)
                           ▼
┌───────────────────────────────────────────────────────────────┐
│              System Integration (Optional)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   macOS      │  │   Windows    │  │    Linux     │       │
│  │   launchd    │  │Task Scheduler│  │systemd/cron  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### 2.2.1 TaskScheduler（任务调度器）

**职责**：
- 管理任务队列
- 调度任务执行
- 触发插件回调
- 处理任务生命周期

**关键方法**：
```typescript
class TaskScheduler {
  // 创建任务
  async createTask(task: TaskInput): Promise<Task>

  // 取消任务
  async cancelTask(taskId: string): Promise<void>

  // 暂停/恢复任务
  async pauseTask(taskId: string): Promise<void>
  async resumeTask(taskId: string): Promise<void>

  // 查询任务
  getTask(taskId: string): Task | null
  listTasks(pluginId?: string): Task[]

  // 启动/停止调度器
  start(): void
  stop(): void

  // 恢复持久化任务
  async restore(): Promise<void>
}
```

#### 2.2.2 TaskStore（任务存储）

**职责**：
- 任务数据持久化
- 任务查询和索引
- 执行历史记录

**存储方案**：
- 使用 better-sqlite3 存储任务数据
- 表结构：tasks、task_executions

**关键方法**：
```typescript
class TaskStore {
  // 保存任务
  async saveTask(task: Task): Promise<void>

  // 删除任务
  async deleteTask(taskId: string): Promise<void>

  // 查询任务
  async getTask(taskId: string): Promise<Task | null>
  async listTasks(filter?: TaskFilter): Promise<Task[]>

  // 执行历史
  async saveExecution(execution: TaskExecution): Promise<void>
  async getExecutions(taskId: string, limit?: number): Promise<TaskExecution[]>
}
```

#### 2.2.3 CronParser（Cron 解析器）

**职责**：
- 解析 cron 表达式
- 计算下次执行时间
- 验证表达式合法性

**Cron 格式**：
```
┌───────────── 秒 (0 - 59)
│ ┌───────────── 分钟 (0 - 59)
│ │ ┌───────────── 小时 (0 - 23)
│ │ │ ┌───────────── 日期 (1 - 31)
│ │ │ │ ┌───────────── 月份 (1 - 12)
│ │ │ │ │ ┌───────────── 星期 (0 - 7, 0 和 7 都表示周日)
│ │ │ │ │ │
* * * * * *
```

**关键方法**：
```typescript
class CronParser {
  // 解析表达式
  parse(expression: string): CronSchedule

  // 计算下次执行时间
  getNextTime(expression: string, after?: Date): Date

  // 验证表达式
  validate(expression: string): boolean

  // 获取可读描述
  describe(expression: string): string
}
```

---

## 3. 数据结构设计

### 3.1 任务类型定义

```typescript
// 任务类型
type TaskType = 'once' | 'repeat' | 'delay'

// 任务状态
type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

// 任务输入
interface TaskInput {
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
  timezone?: string          // 时区（默认系统时区）
  maxRetries?: number        // 最大重试次数（默认 0）
  retryDelay?: number        // 重试延迟（毫秒，默认 60000）
  timeout?: number           // 执行超时（毫秒，默认 30000）

  // 重复任务配置
  endTime?: number           // 结束时间（重复任务）
  maxExecutions?: number     // 最大执行次数（重复任务）
}

// 任务对象
interface Task extends TaskInput {
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
interface TaskExecution {
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
interface TaskFilter {
  pluginId?: string          // 按插件过滤
  status?: TaskStatus        // 按状态过滤
  type?: TaskType            // 按类型过滤
  limit?: number             // 限制数量
  offset?: number            // 偏移量
}
```

### 3.2 数据库表结构

**tasks 表**：
```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,

  -- 时间配置
  time INTEGER,
  cron TEXT,
  delay INTEGER,
  timezone TEXT,

  -- 执行配置
  callback TEXT NOT NULL,
  payload TEXT,
  max_retries INTEGER DEFAULT 0,
  retry_delay INTEGER DEFAULT 60000,
  timeout INTEGER DEFAULT 30000,

  -- 重复任务配置
  end_time INTEGER,
  max_executions INTEGER,

  -- 状态信息
  next_run_time INTEGER,
  last_run_time INTEGER,
  execution_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  last_error TEXT,

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- 索引
  INDEX idx_plugin_id (plugin_id),
  INDEX idx_status (status),
  INDEX idx_next_run_time (next_run_time)
);
```

**task_executions 表**：
```sql
CREATE TABLE IF NOT EXISTS task_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  duration INTEGER,

  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_task_id (task_id),
  INDEX idx_start_time (start_time)
);
```

---

## 4. API 设计

### 4.1 插件 API

在 `api.scheduler` 命名空间下提供以下方法：

#### 4.1.1 创建任务

```typescript
// 创建一次性任务
api.scheduler.schedule({
  name: '会议提醒',
  type: 'once',
  time: Date.now() + 3600000,  // 1小时后
  callback: 'onReminder',
  payload: { message: '1小时后开会' }
})

// 创建重复任务（cron）
api.scheduler.schedule({
  name: '每日备份',
  type: 'repeat',
  cron: '0 0 2 * * *',  // 每天凌晨2点
  callback: 'onBackup',
  payload: { target: '/data' }
})

// 创建延迟任务
api.scheduler.schedule({
  name: '延迟通知',
  type: 'delay',
  delay: 5000,  // 5秒后
  callback: 'onNotify',
  payload: { text: 'Hello' }
})
```

**方法签名**：
```typescript
api.scheduler.schedule(task: TaskInput): Promise<Task>
```

#### 4.1.2 取消任务

```typescript
await api.scheduler.cancel(taskId)
```

**方法签名**：
```typescript
api.scheduler.cancel(taskId: string): Promise<void>
```

#### 4.1.3 暂停/恢复任务

```typescript
// 暂停任务
await api.scheduler.pause(taskId)

// 恢复任务
await api.scheduler.resume(taskId)
```

**方法签名**：
```typescript
api.scheduler.pause(taskId: string): Promise<void>
api.scheduler.resume(taskId: string): Promise<void>
```

#### 4.1.4 查询任务

```typescript
// 获取单个任务
const task = await api.scheduler.get(taskId)

// 列出所有任务
const tasks = await api.scheduler.list()

// 列出指定状态的任务
const pendingTasks = await api.scheduler.list({ status: 'pending' })
```

**方法签名**：
```typescript
api.scheduler.get(taskId: string): Promise<Task | null>
api.scheduler.list(filter?: TaskFilter): Promise<Task[]>
```

#### 4.1.5 获取执行历史

```typescript
const executions = await api.scheduler.getExecutions(taskId, 10)
```

**方法签名**：
```typescript
api.scheduler.getExecutions(taskId: string, limit?: number): Promise<TaskExecution[]>
```

#### 4.1.6 Cron 辅助方法

```typescript
// 验证 cron 表达式
const isValid = api.scheduler.validateCron('0 0 * * * *')

// 获取下次执行时间
const nextTime = api.scheduler.getNextCronTime('0 0 * * * *')

// 获取可读描述
const desc = api.scheduler.describeCron('0 0 2 * * *')
// 返回: "每天凌晨2点"
```

**方法签名**：
```typescript
api.scheduler.validateCron(expression: string): boolean
api.scheduler.getNextCronTime(expression: string, after?: Date): Date
api.scheduler.describeCron(expression: string): string
```

### 4.2 插件回调

插件需要实现任务回调方法：

```typescript
// 在插件中定义回调方法
export async function onReminder({ api, payload }) {
  // payload 是创建任务时传入的数据
  api.notification.show(payload.message)
}

export async function onBackup({ api, payload }) {
  // 执行备份逻辑
  const result = await backupData(payload.target)
  return result  // 返回值会被记录到执行历史
}
```

**回调方法签名**：
```typescript
type TaskCallback = (context: {
  api: PluginAPI
  payload: unknown
  task: Task
}) => void | Promise<void> | Promise<unknown>
```

### 4.3 常用 Cron 表达式示例

```typescript
// 每分钟
'0 * * * * *'

// 每小时
'0 0 * * * *'

// 每天凌晨2点
'0 0 2 * * *'

// 每周一上午9点
'0 0 9 * * 1'

// 每月1号凌晨0点
'0 0 0 1 * *'

// 工作日上午9点
'0 0 9 * * 1-5'

// 每30分钟
'0 */30 * * * *'

// 每天早上8点到晚上6点，每小时执行
'0 0 8-18 * * *'
```

---

## 5. 调度算法设计

### 5.1 任务队列实现

使用**最小堆（Min Heap）**实现优先队列，按 `nextRunTime` 排序：

```typescript
class TaskQueue {
  private heap: Task[] = []

  // 添加任务
  push(task: Task): void {
    this.heap.push(task)
    this.bubbleUp(this.heap.length - 1)
  }

  // 获取最近的任务
  peek(): Task | null {
    return this.heap[0] || null
  }

  // 移除最近的任务
  pop(): Task | null {
    if (this.heap.length === 0) return null
    if (this.heap.length === 1) return this.heap.pop()!

    const top = this.heap[0]
    this.heap[0] = this.heap.pop()!
    this.bubbleDown(0)
    return top
  }

  // 移除指定任务
  remove(taskId: string): boolean {
    const index = this.heap.findIndex(t => t.id === taskId)
    if (index === -1) return false

    if (index === this.heap.length - 1) {
      this.heap.pop()
      return true
    }

    this.heap[index] = this.heap.pop()!
    this.bubbleDown(index)
    return true
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.heap[index].nextRunTime! >= this.heap[parentIndex].nextRunTime!) break
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]]
      index = parentIndex
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      let smallest = index
      const left = 2 * index + 1
      const right = 2 * index + 2

      if (left < this.heap.length &&
          this.heap[left].nextRunTime! < this.heap[smallest].nextRunTime!) {
        smallest = left
      }
      if (right < this.heap.length &&
          this.heap[right].nextRunTime! < this.heap[smallest].nextRunTime!) {
        smallest = right
      }
      if (smallest === index) break

      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]]
      index = smallest
    }
  }
}
```

### 5.2 调度循环

```typescript
class TaskScheduler {
  private queue: TaskQueue = new TaskQueue()
  private timer: NodeJS.Timeout | null = null
  private running: boolean = false

  start(): void {
    if (this.running) return
    this.running = true
    this.scheduleNext()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNext(): void {
    if (!this.running) return

    const nextTask = this.queue.peek()
    if (!nextTask || !nextTask.nextRunTime) {
      // 没有待执行任务，1分钟后再检查
      this.timer = setTimeout(() => this.scheduleNext(), 60000)
      return
    }

    const now = Date.now()
    const delay = nextTask.nextRunTime - now

    if (delay <= 0) {
      // 立即执行
      this.executeTask(nextTask)
      this.scheduleNext()
    } else {
      // 设置定时器
      this.timer = setTimeout(() => {
        this.executeTask(nextTask)
        this.scheduleNext()
      }, Math.min(delay, 2147483647))  // setTimeout 最大值
    }
  }

  private async executeTask(task: Task): Promise<void> {
    // 从队列中移除
    this.queue.pop()

    // 更新状态
    task.status = 'running'
    task.lastRunTime = Date.now()
    await this.store.saveTask(task)

    // 记录执行开始
    const execution: TaskExecution = {
      id: generateId(),
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
        task.nextRunTime = this.calculateNextRunTime(task)
        if (task.nextRunTime) {
          this.queue.push(task)  // 重新加入队列
        } else {
          task.status = 'completed'  // 已达到结束条件
        }
      } else {
        task.status = 'completed'
      }

    } catch (error) {
      execution.endTime = Date.now()
      execution.duration = execution.endTime - execution.startTime
      execution.status = error.message === 'timeout' ? 'timeout' : 'failed'
      execution.error = error.message

      // 更新任务状态
      task.failureCount++
      task.lastError = error.message

      // 重试逻辑
      if (task.maxRetries && task.failureCount <= task.maxRetries) {
        task.status = 'pending'
        task.nextRunTime = Date.now() + (task.retryDelay || 60000)
        this.queue.push(task)
      } else {
        task.status = 'failed'
      }
    }

    // 保存执行记录和任务状态
    await this.store.saveExecution(execution)
    await this.store.saveTask(task)
  }

  private async executeWithTimeout(task: Task): Promise<unknown> {
    const timeout = task.timeout || 30000

    return Promise.race([
      this.callPluginCallback(task),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeout)
      )
    ])
  }

  private async callPluginCallback(task: Task): Promise<unknown> {
    // 通过 PluginManager 调用插件的回调方法
    const plugin = this.pluginManager.getPlugin(task.pluginId)
    if (!plugin) {
      throw new Error(`Plugin not found: ${task.pluginId}`)
    }

    // 调用插件的回调方法
    return await this.pluginManager.callPluginMethod(
      task.pluginId,
      task.callback,
      {
        api: createPluginAPI(task.pluginId),
        payload: task.payload,
        task: task
      }
    )
  }

  private calculateNextRunTime(task: Task): number | null {
    if (task.type !== 'repeat' || !task.cron) return null

    const now = Date.now()

    // 检查结束条件
    if (task.endTime && now >= task.endTime) return null
    if (task.maxExecutions && task.executionCount >= task.maxExecutions) return null

    // 计算下次执行时间
    const nextTime = this.cronParser.getNextTime(task.cron, new Date(now))
    return nextTime.getTime()
  }
}
```

### 5.3 性能优化

1. **批量检查**：每次只检查最近的任务，避免遍历所有任务
2. **最小堆**：O(log n) 的插入和删除复杂度
3. **智能定时器**：根据下次执行时间动态调整检查间隔
4. **索引优化**：数据库查询使用索引加速
5. **内存缓存**：活跃任务保存在内存中，减少数据库访问

---

## 6. 系统级集成方案（可选）

### 6.1 macOS - launchd

**优点**：
- 系统级可靠性，即使应用未运行也能触发
- 支持复杂的时间调度
- 低资源占用

**实现方案**：

```typescript
class MacOSScheduler {
  private plistDir = path.join(os.homedir(), 'Library/LaunchAgents')

  async createLaunchAgent(task: Task): Promise<void> {
    const plistPath = path.join(this.plistDir, `com.intools.task.${task.id}.plist`)

    const plist = {
      Label: `com.intools.task.${task.id}`,
      ProgramArguments: [
        process.execPath,  // InTools 可执行文件路径
        '--execute-task',
        task.id
      ],
      StartCalendarInterval: this.convertCronToCalendar(task.cron),
      RunAtLoad: false,
      StandardOutPath: `/tmp/intools-task-${task.id}.log`,
      StandardErrorPath: `/tmp/intools-task-${task.id}.error.log`
    }

    await fs.writeFile(plistPath, plist.toString('xml'))
    await exec(`launchctl load ${plistPath}`)
  }

  async removeLaunchAgent(taskId: string): Promise<void> {
    const plistPath = path.join(this.plistDir, `com.intools.task.${taskId}.plist`)
    await exec(`launchctl unload ${plistPath}`)
    await fs.unlink(plistPath)
  }

  private convertCronToCalendar(cron: string): object {
    // 将 cron 表达式转换为 launchd 的 StartCalendarInterval 格式
    // 例如: '0 0 9 * * *' -> { Hour: 9, Minute: 0 }
    const parts = cron.split(' ')
    return {
      Minute: parseInt(parts[1]),
      Hour: parseInt(parts[2]),
      Day: parts[3] !== '*' ? parseInt(parts[3]) : undefined,
      Month: parts[4] !== '*' ? parseInt(parts[4]) : undefined,
      Weekday: parts[5] !== '*' ? parseInt(parts[5]) : undefined
    }
  }
}
```

### 6.2 Windows - Task Scheduler

**优点**：
- Windows 原生支持
- 图形界面管理
- 支持触发器和条件

**实现方案**：

```typescript
class WindowsScheduler {
  async createScheduledTask(task: Task): Promise<void> {
    const taskName = `InTools_${task.id}`

    // 使用 schtasks 命令创建任务
    const cronParts = task.cron!.split(' ')
    const schedule = this.convertCronToSchedule(cronParts)

    const command = [
      'schtasks',
      '/Create',
      '/TN', taskName,
      '/TR', `"${process.execPath}" --execute-task ${task.id}`,
      '/SC', schedule.type,
      schedule.modifier ? `/MO ${schedule.modifier}` : '',
      schedule.time ? `/ST ${schedule.time}` : '',
      '/F'  // 强制创建
    ].filter(Boolean).join(' ')

    await exec(command)
  }

  async removeScheduledTask(taskId: string): Promise<void> {
    const taskName = `InTools_${taskId}`
    await exec(`schtasks /Delete /TN ${taskName} /F`)
  }

  private convertCronToSchedule(cronParts: string[]): {
    type: string
    modifier?: string
    time?: string
  } {
    // 将 cron 转换为 schtasks 格式
    // 例如: '0 0 9 * * *' -> { type: 'DAILY', time: '09:00' }
    const [sec, min, hour, day, month, weekday] = cronParts

    if (weekday !== '*') {
      return { type: 'WEEKLY', modifier: weekday, time: `${hour}:${min}` }
    }
    if (day !== '*') {
      return { type: 'MONTHLY', modifier: day, time: `${hour}:${min}` }
    }
    return { type: 'DAILY', time: `${hour}:${min}` }
  }
}
```

### 6.3 Linux - systemd timers

**优点**：
- 现代 Linux 发行版标准
- 与 systemd 集成良好
- 支持复杂的触发条件

**实现方案**：

```typescript
class LinuxScheduler {
  private timerDir = path.join(os.homedir(), '.config/systemd/user')

  async createSystemdTimer(task: Task): Promise<void> {
    const serviceName = `intools-task-${task.id}`

    // 创建 service 文件
    const serviceContent = `
[Unit]
Description=InTools Task: ${task.name}

[Service]
Type=oneshot
ExecStart=${process.execPath} --execute-task ${task.id}
`
    await fs.writeFile(
      path.join(this.timerDir, `${serviceName}.service`),
      serviceContent
    )

    // 创建 timer 文件
    const timerContent = `
[Unit]
Description=InTools Task Timer: ${task.name}

[Timer]
${this.convertCronToOnCalendar(task.cron!)}
Persistent=true

[Install]
WantedBy=timers.target
`
    await fs.writeFile(
      path.join(this.timerDir, `${serviceName}.timer`),
      timerContent
    )

    // 启用并启动 timer
    await exec(`systemctl --user daemon-reload`)
    await exec(`systemctl --user enable ${serviceName}.timer`)
    await exec(`systemctl --user start ${serviceName}.timer`)
  }

  async removeSystemdTimer(taskId: string): Promise<void> {
    const serviceName = `intools-task-${taskId}`
    await exec(`systemctl --user stop ${serviceName}.timer`)
    await exec(`systemctl --user disable ${serviceName}.timer`)
    await fs.unlink(path.join(this.timerDir, `${serviceName}.service`))
    await fs.unlink(path.join(this.timerDir, `${serviceName}.timer`))
  }

  private convertCronToOnCalendar(cron: string): string {
    // 将 cron 转换为 systemd OnCalendar 格式
    // 例如: '0 0 9 * * *' -> 'OnCalendar=*-*-* 09:00:00'
    const parts = cron.split(' ')
    return `OnCalendar=*-*-* ${parts[2]}:${parts[1]}:${parts[0]}`
  }
}
```

### 6.4 系统集成策略

**混合模式**（推荐）：
- 默认使用内置调度器（跨平台一致性）
- 用户可选启用系统级集成（更高可靠性）
- 系统级任务失败时回退到内置调度器

**配置选项**：
```typescript
interface SchedulerConfig {
  useSystemScheduler: boolean  // 是否使用系统级调度器
  fallbackToBuiltin: boolean   // 系统调度器失败时是否回退
}
```

---

## 7. 完整使用示例

### 7.1 定时提醒插件

```typescript
// manifest.json
{
  "id": "com.example.reminder",
  "name": "reminder",
  "displayName": "定时提醒",
  "main": "dist/main.js"
}

// main.ts
export async function run({ api, input }) {
  // 解析用户输入，例如: "3天后提醒我开会"
  const { time, message } = parseInput(input)

  // 创建定时任务
  const task = await api.scheduler.schedule({
    name: `提醒: ${message}`,
    type: 'once',
    time: time,
    callback: 'onReminder',
    payload: { message }
  })

  api.window.setResult(`已设置提醒，将在 ${formatTime(time)} 提醒您`)
  return { taskId: task.id }
}

export async function onReminder({ api, payload }) {
  // 显示通知
  api.notification.show(payload.message)

  // 可选：播放提示音
  api.shell.beep()
}

function parseInput(input: string): { time: number; message: string } {
  // 解析自然语言输入
  // 例如: "3天后提醒我开会" -> { time: Date.now() + 3*24*60*60*1000, message: "开会" }
  // 这里简化处理
  const match = input.match(/(\d+)(分钟|小时|天)后提醒我(.+)/)
  if (!match) throw new Error('无法解析输入')

  const [, amount, unit, message] = match
  const multiplier = { '分钟': 60000, '小时': 3600000, '天': 86400000 }
  const time = Date.now() + parseInt(amount) * multiplier[unit]

  return { time, message: message.trim() }
}
```

### 7.2 每日备份插件

```typescript
// manifest.json
{
  "id": "com.example.backup",
  "name": "backup",
  "displayName": "自动备份",
  "main": "dist/main.js"
}

// main.ts
export async function onLoad({ api }) {
  // 插件加载时创建每日备份任务
  const existingTasks = await api.scheduler.list()
  const hasBackupTask = existingTasks.some(t => t.name === '每日备份')

  if (!hasBackupTask) {
    await api.scheduler.schedule({
      name: '每日备份',
      type: 'repeat',
      cron: '0 0 2 * * *',  // 每天凌晨2点
      callback: 'onBackup',
      payload: {
        source: api.system.getPath('documents'),
        target: api.system.getPath('userData') + '/backups'
      }
    })
  }
}

export async function onBackup({ api, payload }) {
  const { source, target } = payload

  try {
    // 创建备份目录
    const backupDir = api.filesystem.join(
      target,
      `backup-${new Date().toISOString().split('T')[0]}`
    )
    await api.filesystem.mkdir(backupDir)

    // 复制文件
    await api.filesystem.copy(source, backupDir)

    // 记录日志
    console.log(`备份完成: ${backupDir}`)

    // 可选：发送通知
    api.notification.show('每日备份已完成')

    return { success: true, backupDir }
  } catch (error) {
    console.error('备份失败:', error)
    api.notification.show('备份失败，请检查日志')
    throw error
  }
}
```

### 7.3 健康提醒插件

```typescript
// manifest.json
{
  "id": "com.example.health",
  "name": "health",
  "displayName": "健康提醒",
  "main": "dist/main.js"
}

// main.ts
export async function run({ api }) {
  // 创建多个健康提醒任务
  const reminders = [
    {
      name: '喝水提醒',
      cron: '0 0 */2 * * *',  // 每2小时
      message: '该喝水了！保持水分充足'
    },
    {
      name: '休息提醒',
      cron: '0 0 */1 * * *',  // 每小时
      message: '休息一下，看看远方，活动活动'
    },
    {
      name: '站立提醒',
      cron: '0 30 * * * *',  // 每小时的30分
      message: '站起来走动走动，避免久坐'
    }
  ]

  for (const reminder of reminders) {
    await api.scheduler.schedule({
      name: reminder.name,
      type: 'repeat',
      cron: reminder.cron,
      callback: 'onHealthReminder',
      payload: { message: reminder.message }
    })
  }

  api.window.setResult('健康提醒已启动')
}

export async function onHealthReminder({ api, payload }) {
  api.notification.show(payload.message)
}

// 查看所有健康提醒
export async function listReminders({ api }) {
  const tasks = await api.scheduler.list()
  const healthTasks = tasks.filter(t =>
    t.name.includes('提醒') && t.status === 'pending'
  )

  const result = healthTasks.map(t => ({
    name: t.name,
    nextRun: new Date(t.nextRunTime!).toLocaleString(),
    executionCount: t.executionCount
  }))

  api.window.setResult(JSON.stringify(result, null, 2))
}

// 停止所有健康提醒
export async function stopReminders({ api }) {
  const tasks = await api.scheduler.list()
  const healthTasks = tasks.filter(t => t.name.includes('提醒'))

  for (const task of healthTasks) {
    await api.scheduler.cancel(task.id)
  }

  api.window.setResult('所有健康提醒已停止')
}
```

### 7.4 定时任务管理插件

```typescript
// 通用的任务管理插件
export async function run({ api, input }) {
  const [command, ...args] = input.split(' ')

  switch (command) {
    case 'list':
      return await listTasks(api)
    case 'cancel':
      return await cancelTask(api, args[0])
    case 'pause':
      return await pauseTask(api, args[0])
    case 'resume':
      return await resumeTask(api, args[0])
    case 'history':
      return await showHistory(api, args[0])
    default:
      return '未知命令'
  }
}

async function listTasks(api) {
  const tasks = await api.scheduler.list()

  const result = tasks.map(t => ({
    id: t.id.substring(0, 8),
    name: t.name,
    type: t.type,
    status: t.status,
    nextRun: t.nextRunTime ? new Date(t.nextRunTime).toLocaleString() : '-',
    executions: t.executionCount
  }))

  api.window.setResult(JSON.stringify(result, null, 2))
}

async function cancelTask(api, taskId: string) {
  await api.scheduler.cancel(taskId)
  api.window.setResult(`任务 ${taskId} 已取消`)
}

async function showHistory(api, taskId: string) {
  const executions = await api.scheduler.getExecutions(taskId, 10)

  const result = executions.map(e => ({
    time: new Date(e.startTime).toLocaleString(),
    status: e.status,
    duration: e.duration ? `${e.duration}ms` : '-',
    error: e.error || '-'
  }))

  api.window.setResult(JSON.stringify(result, null, 2))
}
```

---

## 8. 实现计划

### 8.1 Phase 1 - 核心调度器（MVP）

**目标**：实现基本的任务调度功能

**任务**：
1. 实现 `TaskStore` - 任务持久化存储
2. 实现 `CronParser` - cron 表达式解析（可使用 `cron-parser` 库）
3. 实现 `TaskScheduler` - 核心调度器
4. 实现 `TaskQueue` - 最小堆优先队列
5. 添加插件 API - `api.scheduler.*`
6. 数据库表创建和迁移

**验收标准**：
- 可以创建一次性任务和重复任务
- 任务可以按时执行
- 任务数据持久化
- 应用重启后任务恢复

**预计时间**：5-7 天

### 8.2 Phase 2 - 高级特性

**目标**：增强可靠性和易用性

**任务**：
1. 实现任务暂停/恢复功能
2. 实现错误重试机制
3. 实现执行历史记录
4. 实现任务超时控制
5. 添加 cron 辅助方法（验证、描述等）
6. 优化调度算法性能

**验收标准**：
- 任务执行失败可以自动重试
- 可以查询任务执行历史
- 任务超时会被终止
- cron 表达式有友好的可读描述

**预计时间**：3-4 天

### 8.3 Phase 3 - 管理界面

**目标**：提供用户友好的管理界面

**任务**：
1. 设计任务管理 UI
2. 实现任务列表展示
3. 实现任务详情查看
4. 实现任务操作（取消、暂停、恢复）
5. 实现执行历史可视化
6. 添加系统托盘指示

**验收标准**：
- 用户可以在 UI 中查看所有任务
- 可以方便地管理任务
- 执行历史以图表形式展示
- 托盘显示活跃任务数量

**预计时间**：4-5 天

### 8.4 Phase 4 - 系统集成（可选）

**目标**：集成操作系统级定时任务

**任务**：
1. 实现 macOS launchd 集成
2. 实现 Windows Task Scheduler 集成
3. 实现 Linux systemd/cron 集成
4. 实现混合模式和回退机制
5. 添加系统集成配置选项

**验收标准**：
- 可以选择使用系统级调度器
- 系统级任务创建成功
- 失败时可以回退到内置调度器

**预计时间**：5-6 天

**总计**：约 17-22 天完成完整功能

---

## 9. 技术选型

### 9.1 依赖库

```json
{
  "dependencies": {
    "cron-parser": "^4.9.0",      // Cron 表达式解析
    "better-sqlite3": "^9.2.2",   // 已有依赖
    "uuid": "^9.0.1"               // 生成任务 ID
  }
}
```

### 9.2 文件结构

```
src/main/scheduler/
├── index.ts                    // 导出主要接口
├── task-scheduler.ts           // 核心调度器
├── task-store.ts               // 任务存储
├── task-queue.ts               // 优先队列
├── cron-parser.ts              // Cron 解析器
├── types.ts                    // 类型定义
├── system-integration/         // 系统集成（可选）
│   ├── macos.ts
│   ├── windows.ts
│   └── linux.ts
└── __tests__/                  // 单元测试
    ├── task-scheduler.test.ts
    ├── task-queue.test.ts
    └── cron-parser.test.ts
```

---

## 10. 最佳实践

### 10.1 任务设计原则

1. **幂等性**：任务应该是幂等的，多次执行结果一致
2. **快速执行**：任务回调应该快速完成，避免阻塞调度器
3. **错误处理**：任务内部应该处理错误，避免抛出未捕获异常
4. **资源清理**：任务完成后应该清理资源

### 10.2 Cron 表达式建议

1. **避免过于频繁**：不要设置秒级的高频任务（如每秒执行）
2. **考虑时区**：明确指定时区，避免夏令时问题
3. **测试表达式**：使用 `validateCron` 和 `describeCron` 验证
4. **使用预设**：对于常见场景，提供预设表达式

### 10.3 性能优化建议

1. **批量操作**：批量创建/删除任务时使用事务
2. **索引优化**：确保数据库查询使用索引
3. **内存控制**：限制内存中的任务数量，大量任务时分页加载
4. **异步执行**：任务执行使用异步，避免阻塞主线程

### 10.4 安全性考虑

1. **权限控制**：插件只能管理自己创建的任务
2. **资源限制**：限制单个插件的任务数量（如最多100个）
3. **执行隔离**：任务执行在插件沙箱中，避免影响主进程
4. **输入验证**：验证 cron 表达式和时间参数的合法性

---

## 11. 监控和调试

### 11.1 日志记录

```typescript
// 记录关键事件
logger.info('scheduler:task-created', { taskId, pluginId, type })
logger.info('scheduler:task-executed', { taskId, duration, status })
logger.warn('scheduler:task-failed', { taskId, error, retryCount })
logger.error('scheduler:task-timeout', { taskId, timeout })
```

### 11.2 性能指标

```typescript
interface SchedulerMetrics {
  totalTasks: number           // 总任务数
  activeTasks: number          // 活跃任务数
  completedTasks: number       // 已完成任务数
  failedTasks: number          // 失败任务数
  avgExecutionTime: number     // 平均执行时间
  successRate: number          // 成功率
}
```

### 11.3 调试工具

```typescript
// 开发者工具
api.scheduler.debug.dumpQueue()           // 导出队列状态
api.scheduler.debug.simulateExecution()   // 模拟任务执行
api.scheduler.debug.getMetrics()          // 获取性能指标
```

---

## 12. 未来扩展

### 12.1 任务依赖

支持任务之间的依赖关系：

```typescript
api.scheduler.schedule({
  name: '任务B',
  type: 'once',
  dependsOn: ['taskA-id'],  // 等待任务A完成后执行
  callback: 'onTaskB'
})
```

### 12.2 任务优先级

支持任务优先级：

```typescript
api.scheduler.schedule({
  name: '高优先级任务',
  priority: 'high',  // high, normal, low
  callback: 'onTask'
})
```

### 12.3 分布式调度

支持多实例协调（如果 InTools 支持多开）：

```typescript
// 使用分布式锁确保任务只执行一次
class DistributedScheduler {
  async acquireLock(taskId: string): Promise<boolean>
  async releaseLock(taskId: string): Promise<void>
}
```

### 12.4 任务链

支持任务链式执行：

```typescript
api.scheduler.chain([
  { callback: 'step1', payload: {} },
  { callback: 'step2', payload: {} },
  { callback: 'step3', payload: {} }
])
```

---

## 13. 总结

任务调度器是 InTools 的重要基础设施，将极大地扩展插件的能力边界。通过本设计方案：

**核心价值**：
- ✅ 解决了插件长期后台运行的问题
- ✅ 提供了统一、易用的定时任务 API
- ✅ 支持灵活的 cron 表达式
- ✅ 可选的系统级集成提供更高可靠性

**技术亮点**：
- 最小堆优先队列，高效调度
- 持久化存储，应用重启不丢失
- 完善的错误处理和重试机制
- 跨平台系统集成方案

**应用场景**：
- 定时提醒、健康提醒
- 自动备份、数据同步
- 监控告警、定期检查
- 自动化工作流

这将使 InTools 成为一个更加强大和完整的生产力工具平台。

