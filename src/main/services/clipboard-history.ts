import { clipboard, nativeImage } from 'electron'
import db from '../db'
import { ClipboardWatcher } from './clipboard-watcher-v2'
import { readFile } from 'fs/promises'
import { getClipboardFormat, readClipboardFiles } from '../utils/clipboard-helper'

interface ClipboardHistoryRow {
  id: string
  type: 'text' | 'image' | 'files'
  content: string
  plain_text: string | null
  files: string | null
  file_path: string | null
  timestamp: number
  size: number
  favorite: number
  tags: string | null
}

/**
 * 剪贴板历史条目
 */
export interface ClipboardHistoryItem {
  id: string
  type: 'text' | 'image' | 'files'
  content: string // 文本内容或小缩略图 base64
  plainText?: string // 纯文本（用于搜索）
  files?: string[] // 文件路径列表
  filePath?: string // 图片文件的原始路径（用于加载大图）
  timestamp: number
  size: number // 字节数
  favorite: boolean // 是否收藏
  tags?: string[] // 标签
}

/**
 * 剪贴板历史管理器
 *
 * 功能：
 * 1. 自动记录剪贴板变化
 * 2. 持久化存储
 * 3. 提供查询 API
 * 4. 支持收藏和标签
 * 5. 自动清理旧记录
 */
export class ClipboardHistoryManager {
  private watcher: ClipboardWatcher
  private enabled: boolean = true
  private maxItems: number = 1000 // 最多保存 1000 条
  private maxImageSize: number = 5 * 1024 * 1024 // 图片最大 5MB
  private ignorePatterns: RegExp[] = [] // 忽略的内容模式（如密码）

  // 批量写入优化
  private pendingItems: ClipboardHistoryItem[] = []
  private writeTimer: NodeJS.Timeout | null = null
  private writeBatchDelay: number = 100 // 100ms 批量写入

  // 暂停控制：超级面板等外部模块可以临时暂停采样，防止模拟复制污染历史
  private isPaused: boolean = false
  private pauseTimer: NodeJS.Timeout | null = null
  // 安全兜底超时：面板可能打开较长时间，30 秒足够覆盖绝大多数使用场景
  // 正常流程中 resume() 一定会在 restoreClipboard() 中被调用，此超时仅作为代码异常的最终保护
  private static readonly PAUSE_SAFETY_TIMEOUT_MS = 30_000

  constructor() {
    this.watcher = new ClipboardWatcher()
    this.initDatabase()
    this.setupWatcher()
  }

  /**
   * 暂停剪贴板历史采样
   *
   * 供超级面板等外部模块在模拟复制前调用，避免临时剪贴板内容被记录。
   * 内置安全计时器（30 秒后自动恢复），仅作为代码异常时的最终保护。
   */
  pause(): void {
    this.isPaused = true
    // 清理旧的安全计时器
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
    }
    // 安全兜底：超时后自动恢复（正常流程不应触发）
    this.pauseTimer = setTimeout(() => {
      if (this.isPaused) {
        console.debug('[ClipboardHistory] 暂停安全超时，自动恢复采样')
        this.resume()
      }
    }, ClipboardHistoryManager.PAUSE_SAFETY_TIMEOUT_MS)
  }

  /**
   * 恢复剪贴板历史采样
   *
   * 在剪贴板内容已恢复后调用。
   */
  resume(): void {
    this.isPaused = false
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
  }

  /**
   * 初始化数据库表
   */
  private initDatabase() {
    // 创建表（如果不存在）
    db.exec(`
      CREATE TABLE IF NOT EXISTS clipboard_history (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        plain_text TEXT,
        files TEXT,
        file_path TEXT,
        timestamp INTEGER NOT NULL,
        size INTEGER NOT NULL,
        favorite INTEGER DEFAULT 0,
        tags TEXT,
        created_at INTEGER NOT NULL
      )
    `)

    // 迁移：添加 file_path 列（如果不存在）
    try {
      db.exec(`ALTER TABLE clipboard_history ADD COLUMN file_path TEXT`)
    } catch (err: unknown) {
      // 列已存在，忽略错误
      if (!(err instanceof Error) || !err.message.includes('duplicate column name')) {
        console.error('[ClipboardHistory] Migration error:', err)
      }
    }

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_clipboard_timestamp ON clipboard_history(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_clipboard_type ON clipboard_history(type);
      CREATE INDEX IF NOT EXISTS idx_clipboard_favorite ON clipboard_history(favorite);
    `)
  }

  /**
   * 设置剪贴板监听器
   */
  private setupWatcher() {
    this.watcher.on('change', async () => {
      if (this.enabled && !this.isPaused) {
        await this.captureClipboard()
      }
    })
  }

  /**
   * 捕获当前剪贴板内容
   */
  private async captureClipboard() {
    try {
      const format = this.getClipboardFormat()
      console.log('[ClipboardHistory] Detected format:', format)

      if (format === 'text') {
        const text = clipboard.readText()
        if (this.shouldIgnore(text)) return

        await this.addTextItem(text)
      } else if (format === 'image') {
        const image = clipboard.readImage()
        if (image.isEmpty()) return

        const buffer = image.toPNG()
        if (buffer.length > this.maxImageSize) return

        await this.addImageItem(buffer)
      } else if (format === 'files') {
        const files = this.readFiles()
        console.log('[ClipboardHistory] Read files:', files)
        if (files.length === 0) return

        // 检查是否为图片文件
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']
        const isImageFile = files.length === 1 && imageExtensions.some(ext =>
          files[0].toLowerCase().endsWith(ext)
        )

        if (isImageFile) {
          // 如果是图片文件，异步生成缩略图并保存文件路径
          try {
            console.log('[ClipboardHistory] Reading image from file:', files[0])
            const imageBuffer = await readFile(files[0])
            const image = nativeImage.createFromBuffer(imageBuffer)

            if (!image.isEmpty()) {
              // 生成小缩略图（100x100）用于列表显示
              const thumbnail = image.resize({ width: 100, height: 100 })
              const thumbnailBuffer = thumbnail.toPNG()

              console.log('[ClipboardHistory] Generated thumbnail for image file')
              await this.addImageItemWithPath(thumbnailBuffer, files[0], imageBuffer.length)
              return
            }
          } catch (err) {
            console.error('[ClipboardHistory] Failed to read image from file:', err)
          }
        }

        // 否则作为文件处理
        await this.addFilesItem(files)
      }
    } catch (err) {
      console.error('Failed to capture clipboard:', err)
    }
  }

  /**
   * 获取剪贴板格式（委托给公共工具函数）
   */
  private getClipboardFormat(): 'text' | 'image' | 'files' | 'empty' {
    return getClipboardFormat()
  }

  /**
   * 读取文件列表（委托给公共工具函数）
   */
  private readFiles(): string[] {
    return readClipboardFiles()
  }

  /**
   * 检查是否应该忽略此内容
   */
  private shouldIgnore(text: string): boolean {
    if (!text || text.trim().length === 0) return true
    if (text.length > 100000) return true // 太大的文本

    // 检查忽略模式
    for (const pattern of this.ignorePatterns) {
      if (pattern.test(text)) return true
    }

    return false
  }

  /**
   * 添加文本条目
   */
  private async addTextItem(text: string) {
    // 检查是否与最近的记录重复
    if (this.isDuplicate('text', text)) {
      return
    }

    const id = this.generateId()
    const item: ClipboardHistoryItem = {
      id,
      type: 'text',
      content: text,
      plainText: text,
      timestamp: Date.now(),
      size: Buffer.byteLength(text, 'utf8'),
      favorite: false
    }

    this.saveItem(item)
    // 清理操作移到批量写入后
  }

  /**
   * 添加图片条目（从剪贴板截图/粘贴）
   */
  private async addImageItem(buffer: Buffer) {
    const base64 = buffer.toString('base64')
    const content = `data:image/png;base64,${base64}`

    // 检查是否与最近的记录重复
    if (this.isDuplicate('image', content)) {
      return
    }

    const id = this.generateId()
    const item: ClipboardHistoryItem = {
      id,
      type: 'image',
      content, // 完整图片 base64（因为没有文件路径）
      timestamp: Date.now(),
      size: buffer.length,
      favorite: false
    }

    this.saveItem(item)
    // 清理操作移到批量写入后
  }

  /**
   * 添加图片条目（从文件）
   */
  private async addImageItemWithPath(thumbnailBuffer: Buffer, filePath: string, originalSize: number) {
    const base64 = thumbnailBuffer.toString('base64')
    const thumbnail = `data:image/png;base64,${base64}`

    // 检查是否与最近的记录重复（使用文件路径）
    if (this.isDuplicate('image', filePath)) {
      return
    }

    const id = this.generateId()
    const item: ClipboardHistoryItem = {
      id,
      type: 'image',
      content: thumbnail, // 小缩略图
      filePath, // 原始文件路径
      timestamp: Date.now(),
      size: originalSize,
      favorite: false
    }

    this.saveItem(item)
    // 清理操作移到批量写入后
  }

  /**
   * 添加文件条目
   */
  private async addFilesItem(files: string[]) {
    const content = files.join('\n')

    // 检查是否与最近的记录重复
    if (this.isDuplicate('files', content)) {
      return
    }

    const id = this.generateId()
    const item: ClipboardHistoryItem = {
      id,
      type: 'files',
      content,
      files,
      timestamp: Date.now(),
      size: files.length,
      favorite: false
    }

    this.saveItem(item)
    // 清理操作移到批量写入后
  }

  /**
   * 检查是否与最近的记录重复
   */
  private isDuplicate(type: string, content: string): boolean {
    const stmt = db.prepare(`
      SELECT content FROM clipboard_history
      WHERE type = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `)
    const row = stmt.get(type) as { content: string } | undefined

    return row ? row.content === content : false
  }

  /**
   * 保存条目到数据库（批量写入优化）
   */
  private saveItem(item: ClipboardHistoryItem) {
    // 加入待写入队列
    this.pendingItems.push(item)

    // 调度批量写入
    this.scheduleBatchWrite()
  }

  /**
   * 调度批量写入
   */
  private scheduleBatchWrite() {
    if (this.writeTimer) return

    this.writeTimer = setTimeout(() => {
      this.flushPendingItems()
      this.writeTimer = null
    }, this.writeBatchDelay)
  }

  /**
   * 批量写入待处理的条目
   */
  private flushPendingItems() {
    if (this.pendingItems.length === 0) return

    const items = [...this.pendingItems]
    this.pendingItems = []

    try {
      // 使用事务批量写入
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO clipboard_history
        (id, type, content, plain_text, files, file_path, timestamp, size, favorite, tags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const transaction = db.transaction((items: ClipboardHistoryItem[]) => {
        for (const item of items) {
          insertStmt.run(
            item.id,
            item.type,
            item.content,
            item.plainText || null,
            item.files ? JSON.stringify(item.files) : null,
            item.filePath || null,
            item.timestamp,
            item.size,
            item.favorite ? 1 : 0,
            item.tags ? JSON.stringify(item.tags) : null,
            Date.now()
          )
        }
      })

      transaction(items)

      // 批量写入后执行一次清理
      this.cleanupOldItems()
    } catch (err) {
      console.error('[ClipboardHistory] Batch write failed:', err)
    }
  }

  /**
   * 清理旧记录
   */
  private cleanupOldItems() {
    // 保留收藏的记录，删除超过限制的普通记录
    const stmt = db.prepare(`
      DELETE FROM clipboard_history
      WHERE favorite = 0
      AND id NOT IN (
        SELECT id FROM clipboard_history
        WHERE favorite = 0
        ORDER BY timestamp DESC
        LIMIT ?
      )
    `)
    stmt.run(this.maxItems)
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `clip_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  /**
   * 查询历史记录
   */
  query(options: {
    type?: 'text' | 'image' | 'files'
    search?: string
    favorite?: boolean
    limit?: number
    offset?: number
  }): ClipboardHistoryItem[] {
    let sql = 'SELECT * FROM clipboard_history WHERE 1=1'
    const params: unknown[] = []

    if (options.type) {
      sql += ' AND type = ?'
      params.push(options.type)
    }

    if (options.search) {
      sql += ' AND plain_text LIKE ?'
      params.push(`%${options.search}%`)
    }

    if (options.favorite !== undefined) {
      sql += ' AND favorite = ?'
      params.push(options.favorite ? 1 : 0)
    }

    sql += ' ORDER BY timestamp DESC'

    if (options.limit) {
      sql += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options.offset) {
      sql += ' OFFSET ?'
      params.push(options.offset)
    }

    const stmt = db.prepare(sql)
    const rows = stmt.all(...params) as ClipboardHistoryRow[]

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      content: row.content,
      plainText: row.plain_text ?? undefined,
      files: row.files ? (JSON.parse(row.files) as string[]) : undefined,
      filePath: row.file_path ?? undefined,
      timestamp: row.timestamp,
      size: row.size,
      favorite: row.favorite === 1,
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : undefined
    }))
  }

  /**
   * 按 ID 查询单条记录
   */
  getById(id: string): ClipboardHistoryItem | null {
    const stmt = db.prepare('SELECT * FROM clipboard_history WHERE id = ?')
    const row = stmt.get(id) as ClipboardHistoryRow | undefined
    if (!row) return null

    return {
      id: row.id,
      type: row.type,
      content: row.content,
      plainText: row.plain_text ?? undefined,
      files: row.files ? (JSON.parse(row.files) as string[]) : undefined,
      filePath: row.file_path ?? undefined,
      timestamp: row.timestamp,
      size: row.size,
      favorite: row.favorite === 1,
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : undefined
    }
  }

  /**
   * 切换收藏状态
   */
  toggleFavorite(id: string) {
    const stmt = db.prepare(`
      UPDATE clipboard_history
      SET favorite = CASE WHEN favorite = 1 THEN 0 ELSE 1 END
      WHERE id = ?
    `)
    stmt.run(id)
  }

  /**
   * 删除条目
   */
  delete(id: string) {
    const stmt = db.prepare('DELETE FROM clipboard_history WHERE id = ?')
    stmt.run(id)
  }

  /**
   * 清空历史（保留收藏）
   */
  clear() {
    const stmt = db.prepare('DELETE FROM clipboard_history WHERE favorite = 0')
    stmt.run()
  }

  /**
   * 启动监听
   */
  start() {
    this.enabled = true
    this.watcher.start()
  }

  /**
   * 停止监听
   */
  stop() {
    this.enabled = false
    this.watcher.stop()

    // 停止时刷新所有待处理的数据
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.flushPendingItems()
  }

  /**
   * 设置忽略模式（如密码、敏感信息）
   */
  setIgnorePatterns(patterns: RegExp[]) {
    this.ignorePatterns = patterns
  }
}
