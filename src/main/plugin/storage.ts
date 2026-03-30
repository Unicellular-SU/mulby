import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync, renameSync } from 'fs'
import db from '../db'

// ====== 命名空间前缀：隔离插件数据，避免与 app / global 等系统 namespace 冲突 ======
const PLUGIN_NS_PREFIX = 'plugin:'

function nsKey(pluginName: string): string {
  return `${PLUGIN_NS_PREFIX}${pluginName}`
}

// ====== 预编译 SQL 语句（复用 store 表，结构：plugin_id, key, value, updated_at） ======

const getStmt = db.prepare('SELECT value FROM store WHERE plugin_id = ? AND key = ?')

const setStmt = db.prepare(`
  INSERT INTO store (plugin_id, key, value, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`)

const removeStmt = db.prepare('DELETE FROM store WHERE plugin_id = ? AND key = ?')

const clearStmt = db.prepare('DELETE FROM store WHERE plugin_id = ?')

const keysStmt = db.prepare('SELECT key FROM store WHERE plugin_id = ?')

const hasStmt = db.prepare('SELECT 1 FROM store WHERE plugin_id = ? AND key = ? LIMIT 1')

const getAllStmt = db.prepare('SELECT key, value FROM store WHERE plugin_id = ?')

// 批量写入事务
const bulkSetTransaction = db.transaction(
  (ns: string, entries: { key: string; value: unknown }[]) => {
    const now = Date.now()
    for (const entry of entries) {
      setStmt.run(ns, entry.key, JSON.stringify(entry.value), now)
    }
  }
)

// 迁移事务：将单个 JSON 文件的数据批量写入 SQLite（合并策略：JSON 数据补充到 SQLite 中）
const migrateTransaction = db.transaction(
  (ns: string, data: Record<string, unknown>) => {
    const now = Date.now()
    for (const [key, value] of Object.entries(data)) {
      // 使用 INSERT OR IGNORE：如果 SQLite 中已有该 key 则跳过，避免覆盖渲染端写入的数据
      db.prepare(
        'INSERT OR IGNORE INTO store (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)'
      ).run(ns, key, JSON.stringify(value), now)
    }
  }
)

export class PluginStorage {
  private migrated = false

  constructor() {
    // 首次实例化时执行数据迁移
    this.migrateFromJson()
  }

  // 获取数据
  get(pluginName: string, key: string): unknown {
    const row = getStmt.get(nsKey(pluginName), key) as { value: string } | undefined
    if (!row) return undefined
    try {
      return JSON.parse(row.value)
    } catch {
      // value 本身不是合法 JSON，直接返回原始字符串
      return row.value
    }
  }

  // 设置数据
  set(pluginName: string, key: string, value: unknown): void {
    setStmt.run(nsKey(pluginName), key, JSON.stringify(value), Date.now())
  }

  // 删除数据
  remove(pluginName: string, key: string): void {
    removeStmt.run(nsKey(pluginName), key)
  }

  // 清空插件所有数据
  clear(pluginName: string): void {
    clearStmt.run(nsKey(pluginName))
  }

  // 获取所有键
  keys(pluginName: string): string[] {
    return (keysStmt.all(nsKey(pluginName)) as { key: string }[]).map(r => r.key)
  }

  // 判断键是否存在
  has(pluginName: string, key: string): boolean {
    return hasStmt.get(nsKey(pluginName), key) !== undefined
  }

  // 获取插件所有数据
  getAll(pluginName: string): Record<string, unknown> {
    const rows = getAllStmt.all(nsKey(pluginName)) as { key: string; value: string }[]
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value)
      } catch {
        result[row.key] = row.value
      }
    }
    return result
  }

  // 批量写入（事务保证原子性）
  bulkSet(pluginName: string, entries: Record<string, unknown>): void {
    const list = Object.entries(entries).map(([key, value]) => ({ key, value }))
    if (list.length === 0) return
    bulkSetTransaction(nsKey(pluginName), list)
  }

  // ====== 数据迁移：JSON 文件 → SQLite ======

  private migrateFromJson(): void {
    if (this.migrated) return
    this.migrated = true

    const storageDir = join(app.getPath('userData'), 'plugin-data')
    if (!existsSync(storageDir)) return

    let files: string[]
    try {
      files = readdirSync(storageDir).filter(f => f.endsWith('.json'))
    } catch {
      return
    }

    if (files.length === 0) return

    let migratedCount = 0

    for (const file of files) {
      const pluginName = file.replace(/\.json$/, '')
      const filePath = join(storageDir, file)
      const ns = nsKey(pluginName)

      try {
        const raw = readFileSync(filePath, 'utf-8')
        const data = JSON.parse(raw) as Record<string, unknown>

        if (Object.keys(data).length === 0) {
          // 空文件，直接重命名归档
          renameSync(filePath, filePath + '.migrated')
          continue
        }

        // 使用 INSERT OR IGNORE 合并策略迁移：
        // - JSON 中有但 SQLite 中没有的 key → 插入
        // - SQLite 中已有的 key → 保留现有值（不覆盖渲染端写入的数据）
        migrateTransaction(ns, data)

        // 迁移成功后将 JSON 文件重命名为 .migrated（保留备份）
        renameSync(filePath, filePath + '.migrated')
        migratedCount++

        console.log(`[PluginStorage] 已迁移插件数据: ${pluginName} (${Object.keys(data).length} keys)`)
      } catch (err) {
        // 迁移失败不影响启动，保留原始 JSON 文件
        console.error(`[PluginStorage] 迁移失败: ${file}`, err)
      }
    }

    if (migratedCount > 0) {
      console.log(`[PluginStorage] 数据迁移完成: ${migratedCount} 个插件`)
    }
  }
}
