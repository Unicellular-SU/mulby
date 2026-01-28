/**
 * Task Store - 任务持久化存储
 * 使用 better-sqlite3 存储任务数据
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type { Task, TaskExecution, TaskFilter } from './types'

export class TaskStore {
  private db: ReturnType<typeof Database>

  constructor() {
    const dbPath = join(app.getPath('userData'), 'task-scheduler.db')
    this.db = new Database(dbPath)
    this.initDatabase()
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
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tasks (
        id, plugin_id, name, description, type, status,
        time, cron, delay, timezone,
        callback, payload, max_retries, retry_delay, timeout,
        end_time, max_executions,
        next_run_time, last_run_time, execution_count, failure_count, last_error,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
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
      task.payload ? JSON.stringify(task.payload) : null,
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
    const row = stmt.get(taskId) as any

    if (!row) return null

    return this.rowToTask(row)
  }

  /**
   * 列出任务
   */
  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    let query = 'SELECT * FROM tasks WHERE 1=1'
    const params: any[] = []

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
    const rows = stmt.all(...params) as any[]

    return rows.map(row => this.rowToTask(row))
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
    const rows = stmt.all() as any[]

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
    const rows = stmt.all(taskId, limit) as any[]

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
  private rowToTask(row: any): Task {
    return {
      id: row.id,
      pluginId: row.plugin_id,
      name: row.name,
      description: row.description,
      type: row.type,
      status: row.status,
      time: row.time,
      cron: row.cron,
      delay: row.delay,
      timezone: row.timezone,
      callback: row.callback,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      maxRetries: row.max_retries,
      retryDelay: row.retry_delay,
      timeout: row.timeout,
      endTime: row.end_time,
      maxExecutions: row.max_executions,
      nextRunTime: row.next_run_time,
      lastRunTime: row.last_run_time,
      executionCount: row.execution_count,
      failureCount: row.failure_count,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /**
   * 将数据库行转换为 TaskExecution 对象
   */
  private rowToExecution(row: any): TaskExecution {
    return {
      id: row.id,
      taskId: row.task_id,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error,
      duration: row.duration
    }
  }
}
