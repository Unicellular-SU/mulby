# 任务调度器 API (scheduler)
本文档描述 任务调度器 API (scheduler) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.scheduler`
> - 插件后端：`context.api.scheduler`

## 概述

任务调度器提供了强大的定时任务功能，支持一次性任务、重复任务和延迟任务。所有任务数据持久化存储，应用重启后自动恢复。

## 任务类型

- **一次性任务 (once)**：在指定时间执行一次
- **重复任务 (repeat)**：按 Cron 表达式周期执行
- **延迟任务 (delay)**：延迟指定时间后执行

## API 方法

### subscribe()
[Renderer]
订阅任务调度实时事件流（主进程 -> 渲染进程）。

```javascript
const result = await window.mulby.scheduler.subscribe()
if (!result.success) {
  console.warn('订阅失败，将使用手动刷新或兜底刷新')
}
```

**返回值**:
- `Promise<{ success: boolean; error?: string }>`

### onEvent(callback)
[Renderer]
监听调度事件。用于驱动任务列表/详情增量刷新，替代高频轮询。

```javascript
const off = window.mulby.scheduler.onEvent((event) => {
  console.log(event.type, event.taskId)
  // 常见做法：触发 refreshTasks()
})

// 销毁时取消监听
off()
```

**事件结构**:
```typescript
{
  type:
    | 'task:created'
    | 'task:cancelled'
    | 'task:paused'
    | 'task:resumed'
    | 'task:success'
    | 'task:failed'
    | 'tasks:deleted'
    | 'tasks:cleaned'
  timestamp: number
  taskId?: string
  deletedCount?: number
  taskIds?: string[]
}
```

### unsubscribe()
[Renderer]
取消订阅任务调度事件流。

```javascript
await window.mulby.scheduler.unsubscribe()
```

**返回值**:
- `Promise<{ success: boolean; error?: string }>`

### listTasks(filter?)
[Renderer]
List tasks from the main-process global scheduler with filter and pagination.

### getTask(taskId)
[Renderer]
Get a single task by id.

### cancelTask(taskId)
[Renderer]
Cancel a task.

### pauseTask(taskId)
[Renderer]
Pause a task.

### resumeTask(taskId)
[Renderer]
Resume a paused task.

### schedule(task)
[Backend]
创建定时任务。

```javascript
// 一次性任务：1小时后提醒
await api.scheduler.schedule({
  name: '会议提醒',
  type: 'once',
  time: Date.now() + 3600000,
  callback: 'onReminder',
  payload: { message: '1小时后开会' }
})

// 重复任务：每天凌晨2点备份
await api.scheduler.schedule({
  name: '每日备份',
  type: 'repeat',
  cron: '0 0 2 * * *',
  callback: 'onBackup',
  payload: { target: '/data' }
})

// 延迟任务：5秒后执行
await api.scheduler.schedule({
  name: '延迟通知',
  type: 'delay',
  delay: 5000,
  callback: 'onNotify',
  payload: { text: 'Hello' }
})
```

**参数**:
- `task` (object) - 任务配置对象
  - `name` (string) - 任务名称
  - `type` (string) - 任务类型：`'once'` | `'repeat'` | `'delay'`
  - `callback` (string) - 回调方法名（插件中导出的方法）
  - `description` (string, 可选) - 任务描述
  - `payload` (any, 可选) - 传递给回调的数据
  - `time` (number, 一次性任务必需) - 执行时间戳（毫秒）
  - `cron` (string, 重复任务必需) - Cron 表达式（6位格式：秒 分 时 日 月 周）
  - `delay` (number, 延迟任务必需) - 延迟毫秒数
  - `timezone` (string, 可选) - 时区，默认系统时区
  - `maxRetries` (number, 可选) - 最大重试次数，默认 0
  - `retryDelay` (number, 可选) - 重试延迟（毫秒），默认 60000
  - `timeout` (number, 可选) - 执行超时（毫秒），默认 30000
  - `endTime` (number, 可选) - 结束时间（重复任务）
  - `maxExecutions` (number, 可选) - 最大执行次数（重复任务）

**返回值**:
- `Promise<Task>` - 创建的任务对象

**任务对象结构**:
```typescript
{
  id: string              // 任务 ID
  pluginId: string        // 插件 ID（自动填充）
  name: string            // 任务名称
  type: 'once' | 'repeat' | 'delay'
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  callback: string        // 回调方法名
  payload?: any           // 传递的数据
  nextRunTime?: number    // 下次执行时间
  lastRunTime?: number    // 上次执行时间
  executionCount: number  // 已执行次数
  failureCount: number    // 失败次数
  createdAt: number       // 创建时间
  updatedAt: number       // 更新时间
}
```

### cancel(taskId)
[Backend]
取消任务。

```javascript
await api.scheduler.cancel(taskId)
```

**参数**:
- `taskId` (string) - 任务 ID

**返回值**:
- `Promise<void>`

### pause(taskId)
[Backend]
暂停任务（仅对 `pending` 状态的任务有效）。

```javascript
await api.scheduler.pause(taskId)
```

**参数**:
- `taskId` (string) - 任务 ID

**返回值**:
- `Promise<void>`

### resume(taskId)
[Backend]
恢复已暂停的任务。

```javascript
await api.scheduler.resume(taskId)
```

**参数**:
- `taskId` (string) - 任务 ID

**返回值**:
- `Promise<void>`

### get(taskId)
[Backend]
获取单个任务信息。

```javascript
const task = await api.scheduler.get(taskId)
```

**参数**:
- `taskId` (string) - 任务 ID

**返回值**:
- `Promise<Task | null>` - 任务对象，不存在返回 `null`

### list(filter?)
[Backend]
列出任务（仅返回当前插件创建的任务）。

```javascript
// 列出所有任务
const tasks = await api.scheduler.list()

// 列出等待中的任务
const pendingTasks = await api.scheduler.list({ status: 'pending' })

// 列出重复任务
const repeatTasks = await api.scheduler.list({ type: 'repeat' })

// 分页查询（每页20条）
const page1 = await api.scheduler.list({ limit: 20, offset: 0 })
const page2 = await api.scheduler.list({ limit: 20, offset: 20 })
```

**参数**:
- `filter` (object, 可选) - 过滤条件
  - `status` (string, 可选) - 按状态过滤
  - `type` (string, 可选) - 按类型过滤
  - `limit` (number, 可选) - 限制数量（用于分页）
  - `offset` (number, 可选) - 偏移量（用于分页）

**返回值**:
- `Promise<Task[]>` - 任务列表

### getTaskCount(filter?)
[Renderer]
获取任务总数（仅统计当前插件创建的任务）。

```javascript
// 获取所有任务数量
const total = await window.mulby.scheduler.getTaskCount()

// 获取等待中的任务数量
const pendingCount = await window.mulby.scheduler.getTaskCount({ status: 'pending' })

// 获取失败的任务数量
const failedCount = await window.mulby.scheduler.getTaskCount({ status: 'failed' })
```

**参数**:
- `filter` (object, 可选) - 过滤条件
  - `status` (string, 可选) - 按状态过滤
  - `type` (string, 可选) - 按类型过滤

**返回值**:
- `Promise<number>` - 任务总数

### deleteTasks(taskIds)
[Renderer]
批量删除任务。

```javascript
// 删除多个任务
const result = await window.mulby.scheduler.deleteTasks([taskId1, taskId2, taskId3])
console.log(`已删除 ${result.deletedCount} 个任务`)

// 删除所有失败的任务
const failedTasks = await window.mulby.scheduler.listTasks({ status: 'failed' })
const taskIds = failedTasks.map(t => t.id)
await window.mulby.scheduler.deleteTasks(taskIds)
```

**参数**:
- `taskIds` (string[]) - 任务 ID 数组

**返回值**:
- `Promise<{ success: boolean; deletedCount: number }>` - 删除结果
  - `success` (boolean) - 是否成功
  - `deletedCount` (number) - 实际删除的任务数量

### cleanupTasks(olderThan?)
[Renderer]
清除已完成、失败或已取消的任务记录。

```javascript
// 清除7天前的任务记录（默认）
const result = await window.mulby.scheduler.cleanupTasks()
console.log(`已清除 ${result.deletedCount} 个任务`)

// 清除30天前的任务记录
const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
await window.mulby.scheduler.cleanupTasks(thirtyDaysAgo)

// 清除所有已完成的任务
await window.mulby.scheduler.cleanupTasks(Date.now())
```

**参数**:
- `olderThan` (number, 可选) - 时间戳（毫秒），清除此时间之前的任务，默认为7天前

**返回值**:
- `Promise<{ success: boolean; deletedCount: number }>` - 清除结果
  - `success` (boolean) - 是否成功
  - `deletedCount` (number) - 实际清除的任务数量

**注意**:
- 只清除状态为 `completed`、`failed`、`cancelled` 的任务
- 不会清除 `pending`、`running`、`paused` 状态的任务

### getExecutions(taskId, limit?)
[Backend]
获取任务执行历史。

```javascript
// 获取最近 10 条执行记录
const executions = await api.scheduler.getExecutions(taskId, 10)
```

**参数**:
- `taskId` (string) - 任务 ID
- `limit` (number, 可选) - 限制数量，默认 50

**返回值**:
- `Promise<TaskExecution[]>` - 执行记录列表

**执行记录结构**:
```typescript
{
  id: string                              // 执行 ID
  taskId: string                          // 任务 ID
  startTime: number                       // 开始时间
  endTime?: number                        // 结束时间
  status: 'success' | 'failed' | 'timeout'
  result?: any                            // 执行结果
  error?: string                          // 错误信息
  duration?: number                       // 执行时长（毫秒）
}
```

### validateCron(expression)
[Backend]
验证 Cron 表达式是否合法。

```javascript
const isValid = api.scheduler.validateCron('0 0 * * * *')
// 返回: true
```

**参数**:
- `expression` (string) - Cron 表达式

**返回值**:
- `boolean` - 是否合法

### getNextCronTime(expression, after?)
[Backend]
计算 Cron 表达式的下次执行时间。

```javascript
const nextTime = api.scheduler.getNextCronTime('0 0 2 * * *')
// 返回: Date 对象，表示下次凌晨2点的时间
```

**参数**:
- `expression` (string) - Cron 表达式
- `after` (Date, 可选) - 起始时间，默认当前时间

**返回值**:
- `Date` - 下次执行时间

### describeCron(expression)
[Backend]
获取 Cron 表达式的中文描述。

```javascript
const desc = api.scheduler.describeCron('0 0 2 * * *')
// 返回: "每天凌晨2点"

const desc2 = api.scheduler.describeCron('0 */30 * * * *')
// 返回: "每30分钟"
```

**参数**:
- `expression` (string) - Cron 表达式

**返回值**:
- `string` - 中文描述

## 插件回调

插件需要导出任务回调方法来处理任务执行：

```javascript
// 在插件中定义回调方法
export async function onReminder({ api, payload, task }) {
  // payload 是创建任务时传入的数据
  api.await notification.show(payload.message)
}

export async function onBackup({ api, payload, task }) {
  // 执行备份逻辑
  const result = await backupData(payload.target)

  // 返回值会被记录到执行历史
  return { success: true, files: 100 }
}
```

**回调参数**:
- `api` (object) - 插件 API 对象
- `payload` (any) - 创建任务时传入的数据
- `task` (Task) - 任务对象

**返回值**:
- 可以返回任意值，会被记录到执行历史的 `result` 字段

## Cron 表达式

### 格式

```
┌───────────── 秒 (0-59)
│ ┌───────────── 分钟 (0-59)
│ │ ┌───────────── 小时 (0-23)
│ │ │ ┌───────────── 日期 (1-31)
│ │ │ │ ┌───────────── 月份 (1-12)
│ │ │ │ │ ┌───────────── 星期 (0-7, 0和7都表示周日)
│ │ │ │ │ │
* * * * * *
```

### 常用示例

```javascript
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

## 完整示例

### 示例 1：定时提醒插件

```javascript
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
  api.await notification.show(payload.message)

  // 可选：播放提示音
  api.await shell.beep()
}

function parseInput(input) {
  // 解析自然语言输入
  const match = input.match(/(\d+)(分钟|小时|天)后提醒我(.+)/)
  if (!match) throw new Error('无法解析输入')

  const [, amount, unit, message] = match
  const multiplier = { '分钟': 60000, '小时': 3600000, '天': 86400000 }
  const time = Date.now() + parseInt(amount) * multiplier[unit]

  return { time, message: message.trim() }
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN')
}
```

### 示例 2：每日备份插件

```javascript
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
        source: api.await system.getPath('documents'),
        target: api.await system.getPath('userData') + '/backups'
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

    // 发送通知
    api.await notification.show('每日备份已完成')

    return { success: true, backupDir }
  } catch (error) {
    api.await notification.show('备份失败，请检查日志', 'error')
    throw error
  }
}
```

### 示例 3：健康提醒插件

```javascript
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
  api.await notification.show(payload.message)
}

// 查看所有健康提醒
export async function listReminders({ api }) {
  const tasks = await api.scheduler.list()
  const healthTasks = tasks.filter(t =>
    t.name.includes('提醒') && t.status === 'pending'
  )

  const result = healthTasks.map(t => ({
    name: t.name,
    nextRun: new Date(t.nextRunTime).toLocaleString(),
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

## 最佳实践

### 1. 任务幂等性

任务应该是幂等的，多次执行结果一致：

```javascript
// ✅ 好的做法
export async function onBackup({ api, payload }) {
  const backupDir = `backup-${Date.now()}`
  await api.filesystem.mkdir(backupDir)
  await api.filesystem.copy(payload.source, backupDir)
}

// ❌ 不好的做法（可能重复追加）
export async function onLog({ api, payload }) {
  await api.filesystem.appendFile('log.txt', payload.message)
}
```

### 2. 快速执行

任务回调应该快速完成，避免阻塞调度器：

```javascript
// ✅ 好的做法
export async function onTask({ api }) {
  // 快速操作
  api.await notification.show('任务完成')
}

// ❌ 不好的做法（长时间运行）
export async function onTask({ api }) {
  // 避免长时间循环
  for (let i = 0; i < 1000000; i++) {
    // ...
  }
}
```

### 3. 错误处理

任务内部应该处理错误：

```javascript
export async function onTask({ api, payload }) {
  try {
    await doSomething(payload)
    return { success: true }
  } catch (error) {
    // 记录错误
    console.error('Task failed:', error)
    // 抛出错误会触发重试机制
    throw error
  }
}
```

### 4. 资源清理

任务完成后应该清理资源：

```javascript
export async function onTask({ api }) {
  const tempFile = '/tmp/temp.txt'

  try {
    await api.filesystem.writeFile(tempFile, 'data')
    // 处理文件
  } finally {
    // 清理临时文件
    await api.filesystem.remove(tempFile)
  }
}
```

### 5. 使用重试机制

对于可能失败的任务，配置重试：

```javascript
await api.scheduler.schedule({
  name: '网络请求',
  type: 'once',
  time: Date.now() + 1000,
  callback: 'onRequest',
  maxRetries: 3,        // 最多重试3次
  retryDelay: 30000     // 每次重试间隔30秒
})
```

## 注意事项

1. **任务持久化**：所有任务数据持久化存储，应用重启后自动恢复
2. **插件隔离**：每个插件只能管理自己创建的任务
3. **时区处理**：默认使用系统时区，可通过 `timezone` 参数指定
4. **超时控制**：任务执行超时（默认30秒）会被终止
5. **执行历史**：执行记录会被保存，可通过 `getExecutions` 查询
6. **Cron 格式**：使用 6 位格式（秒 分 时 日 月 周）
7. **应用运行**：任务调度依赖应用运行，建议启用"开机自启动"

## 管理界面

用户可以通过设置界面打开任务调度器管理界面：

1. 打开 Mulby 主窗口
2. 点击设置图标
3. 在"通用"设置中找到"任务调度器"
4. 点击"打开任务调度器"按钮

管理界面提供：
- **查看任务列表**：支持分页显示（每页20条）
- **过滤任务**：全部、进行中、已完成、失败
- **批量操作**：
  - 复选框选择任务
  - 全选/取消全选
  - 批量删除选中的任务
- **清除记录**：一键清除已完成/失败/取消的任务（保留最近7天）
- **任务详情**：查看任务配置和执行历史
- **任务控制**：暂停/恢复/取消单个任务
- **实时刷新**：默认使用事件驱动刷新（可开关），并保留低频兜底恢复
- **分页导航**：上一页/下一页，页码快速跳转

### 分页查询示例

```javascript
// 实现分页查询
const pageSize = 20
const currentPage = 1

// 获取当前页数据
const tasks = await window.mulby.scheduler.listTasks({
  status: 'pending',
  limit: pageSize,
  offset: (currentPage - 1) * pageSize
})

// 获取总数（用于计算总页数）
const totalCount = await window.mulby.scheduler.getTaskCount({ status: 'pending' })
const totalPages = Math.ceil(totalCount / pageSize)

console.log(`第 ${currentPage}/${totalPages} 页，共 ${totalCount} 个任务`)
```

### 批量管理示例

```javascript
// 批量删除失败的任务
const failedTasks = await window.mulby.scheduler.listTasks({ status: 'failed' })
const taskIds = failedTasks.map(t => t.id)
const result = await window.mulby.scheduler.deleteTasks(taskIds)
console.log(`已删除 ${result.deletedCount} 个失败任务`)

// 定期清理旧任务（保留最近30天）
const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
const cleanupResult = await window.mulby.scheduler.cleanupTasks(thirtyDaysAgo)
console.log(`已清理 ${cleanupResult.deletedCount} 个旧任务`)
```
