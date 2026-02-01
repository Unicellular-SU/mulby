import { clipboard } from 'electron'
import db from '../db'
import { ClipboardWatcher } from './clipboard-watcher-v2'

/**
 * 剪贴板历史条目
 */
export interface ClipboardHistoryItem {
  id: string
  type: 'text' | 'image' | 'files'
  content: string // 文本内容或 base64 图片
  plainText?: string // 纯文本（用于搜索）
  files?: string[] // 文件路径列表
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

  constructor() {
    this.watcher = new ClipboardWatcher()
    this.initDatabase()
    this.setupWatcher()
  }

  /**
   * 初始化数据库表
   */
  private initDatabase() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS clipboard_history (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        plain_text TEXT,
        files TEXT,
        timestamp INTEGER NOT NULL,
        size INTEGER NOT NULL,
        favorite INTEGER DEFAULT 0,
        tags TEXT,
        created_at INTEGER NOT NULL
      )
    `)

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
      if (this.enabled) {
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
        if (files.length === 0) return

        await this.addFilesItem(files)
      }
    } catch (err) {
      console.error('Failed to capture clipboard:', err)
    }
  }

  /**
   * 获取剪贴板格式
   */
  private getClipboardFormat(): 'text' | 'image' | 'files' | 'empty' {
    if (!clipboard.readImage().isEmpty()) return 'image'

    const formats = clipboard.availableFormats()
    if (formats.includes('text/uri-list') || formats.includes('NSFilenamesPboardType')) {
      return 'files'
    }

    if (clipboard.readText()) return 'text'

    return 'empty'
  }

  /**
   * 读取文件列表
   */
  private readFiles(): string[] {
    // 简化实现，实际应该从 clipboard 读取
    return []
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
    this.cleanupOldItems()
  }

  /**
   * 添加图片条目
   */
  private async addImageItem(buffer: Buffer) {
    const id = this.generateId()
    const base64 = buffer.toString('base64')

    const item: ClipboardHistoryItem = {
      id,
      type: 'image',
      content: `data:image/png;base64,${base64}`,
      timestamp: Date.now(),
      size: buffer.length,
      favorite: false
    }

    this.saveItem(item)
    this.cleanupOldItems()
  }

  /**
   * 添加文件条目
   */
  private async addFilesItem(files: string[]) {
    const id = this.generateId()
    const item: ClipboardHistoryItem = {
      id,
      type: 'files',
      content: files.join('\n'),
      files,
      timestamp: Date.now(),
      size: files.length,
      favorite: false
    }

    this.saveItem(item)
    this.cleanupOldItems()
  }

  /**
   * 保存条目到数据库
   */
  private saveItem(item: ClipboardHistoryItem) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO clipboard_history
      (id, type, content, plain_text, files, timestamp, size, favorite, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      item.id,
      item.type,
      item.content,
      item.plainText || null,
      item.files ? JSON.stringify(item.files) : null,
      item.timestamp,
      item.size,
      item.favorite ? 1 : 0,
      item.tags ? JSON.stringify(item.tags) : null,
      Date.now()
    )
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
    const params: any[] = []

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
    const rows = stmt.all(...params) as any[]

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      content: row.content,
      plainText: row.plain_text,
      files: row.files ? JSON.parse(row.files) : undefined,
      timestamp: row.timestamp,
      size: row.size,
      favorite: row.favorite === 1,
      tags: row.tags ? JSON.parse(row.tags) : undefined
    }))
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
  }

  /**
   * 设置忽略模式（如密码、敏感信息）
   */
  setIgnorePatterns(patterns: RegExp[]) {
    this.ignorePatterns = patterns
  }
}
