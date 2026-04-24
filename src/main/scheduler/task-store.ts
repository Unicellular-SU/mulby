/**
 * Task Store - 任务持久化存储
 * 使用 better-sqlite3 存储任务数据
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type { Task, TaskExecution, TaskFilter } from './types'
import log from 'electron-log'

type TaskColumnInfo = { name?: string }

type TaskRow = {
  id: string
  plugin_id: string
  name: string
  description: string | null
  type: Task['type']
  status: Task['status']
  time: number | null
  cron: string | null
  delay: number | null
  timezone: string | null
  callback: string
  payload: string | null
  priority: number | null
  max_retries: number | null
  retry_delay: number | null
  timeout: number | null
  end_time: number | null
  max_executions: number | null
  next_run_time: number | null
  last_run_time: number | null
  execution_count: number | null
  failure_count: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

type ExecutionRow = {
  id: string
  task_id: string
  start_time: number
  end_time: number | null
  status: TaskExecution['status']
  result: string | null
  error: string | null
  duration: number | null
}

export class TaskStore {
  private db: ReturnType<typeof Database>

  constructor() {
    const dbPath = join(app.getPath('userData'), 'task-scheduler.db')
    this.db = new Database(dbPath)

    // 启用 WAL 模式以提高并发性能
    this.db.pragma('journal_mode = WAL')

    this.initDatabase()
    this.migrateDatabase()
  }

  /**
   * 数据库迁移
   */
  private migrateDatabase(): void {
    // 检查 priority 字段是否存在
    const columns = this.db.pragma('table_info(tasks)') as TaskColumnInfo[]
    const hasPriority = columns.some(col => col.name === 'priority')

    if (!hasPriority) {
      log.info('[TaskStore] Migrating database: adding priority column')
      this.db.exec(`ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 5;`)
      log.info('[TaskStore] Database migration completed')
    }

    // 创建 priority 索引（无论是否迁移都要确保索引存在）
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_priority ON tasks(priority);`)
  }

  /**
   * 初始化数据库表
   */
  private initDatabase(): void {
    // 创建 tasks 表
    this.db.exec(`
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
        priority INTEGER DEFAULT 5,
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
        updated_at INTEGER NOT NULL
      )
    `)

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plugin_id ON tasks(plugin_id);
      CREATE INDEX IF NOT EXISTS idx_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_next_run_time ON tasks(next_run_time);
    `)

    // 创建 task_executions 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_executions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        duration INTEGER,

        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `)

    // 创建执行记录索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_id ON task_executions(task_id);
      CREATE INDEX IF NOT EXISTS idx_start_time ON task_executions(start_time);
    `)
  }

  /**
   * 保存任务
   */
  async saveTask(task: Task): Promise<void> {
    // 使用 INSERT ... ON CONFLICT DO UPDATE 来避免触发 DELETE CASCADE
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, plugin_id, name, description, type, status,
        time, cron, delay, timezone,
        callback, payload, priority, max_retries, retry_delay, timeout,
        end_time, max_executions,
        next_run_time, last_run_time, execution_count, failure_count, last_error,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        plugin_id = excluded.plugin_id,
        name = excluded.name,
        description = excluded.description,
        type = excluded.type,
        status = excluded.status,
        time = excluded.time,
        cron = excluded.cron,
        delay = excluded.delay,
        timezone = excluded.timezone,
        callback = excluded.callback,
        payload = excluded.payload,
        priority = excluded.priority,
        max_retries = excluded.max_retries,
        retry_delay = excluded.retry_delay,
        timeout = excluded.timeout,
        end_time = excluded.end_time,
        max_executions = excluded.max_executions,
        next_run_time = excluded.next_run_time,
        last_run_time = excluded.last_run_time,
        execution_count = excluded.execution_count,
        failure_count = excluded.failure_count,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `)

    stmt.run(
      task.id,
      task.pluginId,
      task.name,
      task.description || null,
      task.type,
      task.status,
      task.time || null,
      task.cron || null,
      task.delay || null,
      task.timezone || null,
      task.callback,
      task.payload !== undefined ? JSON.stringify(task.payload) : null,
      task.priority ?? 5,
      task.maxRetries || 0,
      task.retryDelay || 60000,
      task.timeout || 30000,
      task.endTime || null,
      task.maxExecutions || null,
      task.nextRunTime || null,
      task.lastRunTime || null,
      task.executionCount || 0,
      task.failureCount || 0,
      task.lastError || null,
      task.createdAt,
      task.updatedAt
    )
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?')
    stmt.run(taskId)
  }

  /**
   * 获取单个任务
   */
  async getTask(taskId: string): Promise<Task | null> {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?')
    const row = stmt.get(taskId) as TaskRow | undefined

    if (!row) return null

    return this.rowToTask(row)
  }

  /**
   * 列出任务
   */
  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    let query = 'SELECT * FROM tasks WHERE 1=1'
    const params: unknown[] = []

    if (filter?.pluginId) {
      query += ' AND plugin_id = ?'
      params.push(filter.pluginId)
    }

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }

    if (filter?.type) {
      query += ' AND type = ?'
      params.push(filter.type)
    }

    query += ' ORDER BY created_at DESC'

    if (filter?.limit) {
      query += ' LIMIT ?'
      params.push(filter.limit)
    }

    if (filter?.offset) {
      query += ' OFFSET ?'
      params.push(filter.offset)
    }

    const stmt = this.db.prepare(query)
    const rows = stmt.all(...params) as TaskRow[]

    return rows.map(row => this.rowToTask(row))
  }

  /**
   * 获取任务总数
   */
  async getTaskCount(filter?: Omit<TaskFilter, 'limit' | 'offset'>): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM tasks WHERE 1=1'
    const params: unknown[] = []

    if (filter?.pluginId) {
      query += ' AND plugin_id = ?'
      params.push(filter.pluginId)
    }

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }

    if (filter?.type) {
      query += ' AND type = ?'
      params.push(filter.type)
    }

    const stmt = this.db.prepare(query)
    const result = stmt.get(...params) as { count: number }
    return result.count
  }

  /**
   * 清除已完成/失败/取消的任务
   */
  async cleanupTasks(olderThan?: number): Promise<number> {
    const cutoffTime = olderThan || Date.now() - 7 * 24 * 60 * 60 * 1000 // 默认7天前

    const stmt = this.db.prepare(`
      DELETE FROM tasks
      WHERE status IN ('completed', 'failed', 'cancelled')
      AND updated_at < ?
    `)
    const result = stmt.run(cutoffTime)
    return result.changes
  }

  /**
   * 获取待执行的任务
   */
  async getPendingTasks(): Promise<Task[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'pending' AND next_run_time IS NOT NULL
      ORDER BY next_run_time ASC
    `)
    const rows = stmt.all() as TaskRow[]

    return rows.map(row => this.rowToTask(row))
  }

  /**
   * 保存执行记录
   */
  async saveExecution(execution: TaskExecution): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO task_executions (
        id, task_id, start_time, end_time, status, result, error, duration
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      execution.id,
      execution.taskId,
      execution.startTime,
      execution.endTime || null,
      execution.status,
      execution.result ? JSON.stringify(execution.result) : null,
      execution.error || null,
      execution.duration || null
    )
  }

  /**
   * 获取任务执行历史
   */
  async getExecutions(taskId: string, limit = 50): Promise<TaskExecution[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM task_executions
      WHERE task_id = ?
      ORDER BY start_time DESC
      LIMIT ?
    `)
    const rows = stmt.all(taskId, limit) as ExecutionRow[]

    return rows.map(row => this.rowToExecution(row))
  }

  /**
   * 清理旧的执行记录
   */
  async cleanupExecutions(olderThan: number): Promise<number> {
    const stmt = this.db.prepare(`
      DELETE FROM task_executions
      WHERE start_time < ?
    `)
    const result = stmt.run(olderThan)
    return result.changes
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close()
  }

  /**
   * 将数据库行转换为 Task 对象
   */
  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      pluginId: row.plugin_id,
      name: row.name,
      description: row.description ?? undefined,
      type: row.type,
      status: row.status,
      time: row.time ?? undefined,
      cron: row.cron ?? undefined,
      delay: row.delay ?? undefined,
      timezone: row.timezone ?? undefined,
      callback: row.callback,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      priority: row.priority ?? 5,
      maxRetries: row.max_retries ?? undefined,
      retryDelay: row.retry_delay ?? undefined,
      timeout: row.timeout ?? undefined,
      endTime: row.end_time ?? undefined,
      maxExecutions: row.max_executions ?? undefined,
      nextRunTime: row.next_run_time ?? undefined,
      lastRunTime: row.last_run_time ?? undefined,
      executionCount: row.execution_count ?? 0,
      failureCount: row.failure_count ?? 0,
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /**
   * 将数据库行转换为 TaskExecution 对象
   */
  private rowToExecution(row: ExecutionRow): TaskExecution {
    return {
      id: row.id,
      taskId: row.task_id,
      startTime: row.start_time,
      endTime: row.end_time ?? undefined,
      status: row.status,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error ?? undefined,
      duration: row.duration ?? undefined
    }
  }
}
