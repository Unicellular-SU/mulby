import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync, renameSync } from 'fs'
import db from '../db'
import type {
import log from 'electron-log'
  StorageListOptions,
  StorageListResult,
  StorageListItem,
  StorageGetManyItem,
  StorageSetManyItem,
  StorageSetManyResult,
  StorageSetManyResultItem,
  StorageMetaResult,
  StorageSetVersionResult,
  StorageRemoveVersionResult,
  StorageTransactionOp,
  StorageTransactionResult,
  StorageAppendOptions,
  StorageAppendResult,
  StorageErrorCode
} from '../../shared/types/storage-v2'

// ====== 命名空间前缀：隔离插件数据，避免与 app / global 等系统 namespace 冲突 ======
const PLUGIN_NS_PREFIX = 'plugin:'

function nsKey(pluginName: string): string {
  return `${PLUGIN_NS_PREFIX}${pluginName}`
}

// ====== 预编译 SQL 语句（复用 store 表，结构：plugin_id, key, value, updated_at） ======

const getStmt = db.prepare('SELECT value FROM store WHERE plugin_id = ? AND key = ?')

const setStmt = db.prepare(`
  INSERT INTO store (plugin_id, key, value, updated_at, version)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, version = version + 1
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

// ====== V2 预编译 SQL 语句 ======

// list: 按前缀分页遍历（4 种组合：有/无 cursor × asc/desc）
const listAscStmt = db.prepare(
  'SELECT key, LENGTH(value) as size, updated_at, version FROM store WHERE plugin_id = ? AND key > ? AND key LIKE ? ORDER BY key ASC LIMIT ?'
)
const listDescStmt = db.prepare(
  'SELECT key, LENGTH(value) as size, updated_at, version FROM store WHERE plugin_id = ? AND key < ? AND key LIKE ? ORDER BY key DESC LIMIT ?'
)
const listAscNoCursorStmt = db.prepare(
  'SELECT key, LENGTH(value) as size, updated_at, version FROM store WHERE plugin_id = ? AND key LIKE ? ORDER BY key ASC LIMIT ?'
)
const listDescNoCursorStmt = db.prepare(
  'SELECT key, LENGTH(value) as size, updated_at, version FROM store WHERE plugin_id = ? AND key LIKE ? ORDER BY key DESC LIMIT ?'
)

// getMeta: 获取值 + 元数据
const getMetaStmt = db.prepare(
  'SELECT value, version, updated_at FROM store WHERE plugin_id = ? AND key = ?'
)

// CAS: 条件更新（version 匹配时才更新）
const casUpdateStmt = db.prepare(
  'UPDATE store SET value = ?, version = version + 1, updated_at = ? WHERE plugin_id = ? AND key = ? AND version = ?'
)

// CAS: 仅在 key 不存在时插入
const casInsertOnlyStmt = db.prepare(
  'INSERT OR IGNORE INTO store (plugin_id, key, value, updated_at, version) VALUES (?, ?, ?, ?, 1)'
)

// CAS: 条件删除（version 匹配时才删除）
const removeWithVersionStmt = db.prepare(
  'DELETE FROM store WHERE plugin_id = ? AND key = ? AND version = ?'
)

// setMany 原子事务
const setManyAtomicTransaction = db.transaction(
  (ns: string, items: StorageSetManyItem[]): StorageSetManyResult => {
    const results: StorageSetManyResultItem[] = []
    const conflicts: Array<{ key: string; currentVersion: number }> = []
    const now = Date.now()

    for (const item of items) {
      if (item.expectedVersion === undefined) {
        // 无条件写入
        setStmt.run(ns, item.key, JSON.stringify(item.value), now)
        const row = getMetaStmt.get(ns, item.key) as { version: number } | undefined
        results.push({ key: item.key, ok: true, version: row?.version ?? 1 })
      } else if (item.expectedVersion === null) {
        // 仅在 key 不存在时写入
        const info = casInsertOnlyStmt.run(ns, item.key, JSON.stringify(item.value), now)
        if (info.changes === 0) {
          const existing = getMetaStmt.get(ns, item.key) as { version: number } | undefined
          conflicts.push({ key: item.key, currentVersion: existing?.version ?? 0 })
          results.push({ key: item.key, ok: false, error: 'E_CONFLICT' })
        } else {
          results.push({ key: item.key, ok: true, version: 1 })
        }
      } else {
        // CAS: 版本号匹配时更新
        const info = casUpdateStmt.run(JSON.stringify(item.value), now, ns, item.key, item.expectedVersion)
        if (info.changes === 0) {
          const existing = getMetaStmt.get(ns, item.key) as { version: number } | undefined
          conflicts.push({ key: item.key, currentVersion: existing?.version ?? 0 })
          results.push({ key: item.key, ok: false, error: 'E_CONFLICT' })
        } else {
          const updated = getMetaStmt.get(ns, item.key) as { version: number } | undefined
          results.push({ key: item.key, ok: true, version: updated?.version ?? item.expectedVersion + 1 })
        }
      }
    }

    // 原子模式：任一冲突则抛出异常触发回滚
    if (conflicts.length > 0) {
      // better-sqlite3 的 transaction 在抛异常时自动回滚
      const error = new Error('E_CONFLICT') as Error & { conflicts: typeof conflicts; results: typeof results }
      error.conflicts = conflicts
      error.results = results.map(r => conflicts.some(c => c.key === r.key) ? r : { ...r, ok: false, error: 'E_TX_ABORTED' as StorageErrorCode })
      throw error
    }

    return { success: true, results }
  }
)

// transaction 执行器
const transactionExec = db.transaction(
  (ns: string, ops: StorageTransactionOp[]): StorageTransactionResult => {
    const conflicts: Array<{ key: string; currentVersion: number }> = []
    const now = Date.now()
    let committed = 0

    for (const op of ops) {
      if (op.op === 'set') {
        if (op.expectedVersion === undefined) {
          setStmt.run(ns, op.key, JSON.stringify(op.value), now)
          committed++
        } else if (op.expectedVersion === null) {
          const info = casInsertOnlyStmt.run(ns, op.key, JSON.stringify(op.value), now)
          if (info.changes === 0) {
            const existing = getMetaStmt.get(ns, op.key) as { version: number } | undefined
            conflicts.push({ key: op.key, currentVersion: existing?.version ?? 0 })
          } else {
            committed++
          }
        } else {
          const info = casUpdateStmt.run(JSON.stringify(op.value), now, ns, op.key, op.expectedVersion)
          if (info.changes === 0) {
            const existing = getMetaStmt.get(ns, op.key) as { version: number } | undefined
            conflicts.push({ key: op.key, currentVersion: existing?.version ?? 0 })
          } else {
            committed++
          }
        }
      } else if (op.op === 'remove') {
        if (op.expectedVersion === undefined || op.expectedVersion === null) {
          removeStmt.run(ns, op.key)
          committed++
        } else {
          const info = removeWithVersionStmt.run(ns, op.key, op.expectedVersion)
          if (info.changes === 0) {
            const existing = getMetaStmt.get(ns, op.key) as { version: number } | undefined
            conflicts.push({ key: op.key, currentVersion: existing?.version ?? 0 })
          } else {
            committed++
          }
        }
      }
    }

    if (conflicts.length > 0) {
      const error = new Error('E_TX_ABORTED') as Error & { result: StorageTransactionResult }
      error.result = { success: false, committed: 0, conflicts }
      throw error
    }

    return { success: true, committed }
  }
)

// append 执行器（事务内：get → 解析 → push → 写回）
const appendExec = db.transaction(
  (ns: string, key: string, chunk: unknown, options?: StorageAppendOptions): StorageAppendResult => {
    const now = Date.now()
    const existing = getMetaStmt.get(ns, key) as { value: string; version: number } | undefined

    let arr: unknown[]
    if (existing) {
      try {
        const parsed = JSON.parse(existing.value)
        arr = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        arr = [existing.value]
      }
    } else {
      arr = []
    }

    // 追加新元素
    if (Array.isArray(chunk)) {
      arr.push(...chunk)
    } else {
      arr.push(chunk)
    }

    // maxItems 滚动窗口：截断头部
    if (options?.maxItems && options.maxItems > 0 && arr.length > options.maxItems) {
      arr = arr.slice(arr.length - options.maxItems)
    }

    // 写回
    setStmt.run(ns, key, JSON.stringify(arr), now)
    const updated = getMetaStmt.get(ns, key) as { version: number } | undefined

    return { ok: true, newLength: arr.length, version: updated?.version ?? 1 }
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

  // ====== V2 扩展方法 ======

  // 按前缀分页遍历键
  list(pluginName: string, options: StorageListOptions = {}): StorageListResult {
    const ns = nsKey(pluginName)
    const prefix = options.prefix ?? ''
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500)
    const order = options.order ?? 'asc'
    const startsAfter = options.startsAfter
    const pattern = prefix ? `${prefix}%` : '%'

    let rows: Record<string, unknown>[]
    if (startsAfter !== undefined) {
      if (order === 'asc') {
        rows = listAscStmt.all(ns, startsAfter, pattern, limit) as Record<string, unknown>[]
      } else {
        rows = listDescStmt.all(ns, startsAfter, pattern, limit) as Record<string, unknown>[]
      }
    } else {
      if (order === 'asc') {
        rows = listAscNoCursorStmt.all(ns, pattern, limit) as Record<string, unknown>[]
      } else {
        rows = listDescNoCursorStmt.all(ns, pattern, limit) as Record<string, unknown>[]
      }
    }

    // 统一字段名映射（SQLite 列名 → 类型字段名）
    const items: StorageListItem[] = rows.map(r => ({
      key: r.key as string,
      size: (r.size ?? r['LENGTH(value)'] ?? 0) as number,
      updatedAt: (r.updatedAt ?? r.updated_at ?? 0) as number,
      version: (r.version ?? 0) as number
    }))

    const nextCursor = items.length === limit ? items[items.length - 1].key : undefined
    return { items, nextCursor }
  }

  // 批量读取
  getMany(pluginName: string, keys: string[]): StorageGetManyItem[] {
    if (keys.length === 0) return []
    const ns = nsKey(pluginName)
    return keys.map(key => {
      const row = getMetaStmt.get(ns, key) as { value: string; version: number; updated_at: number } | undefined
      if (!row) return { key, found: false }
      let value: unknown
      try { value = JSON.parse(row.value) } catch { value = row.value }
      return { key, found: true, value, version: row.version ?? 0, updatedAt: row.updated_at }
    })
  }

  // 批量写入（支持 CAS 和原子模式）
  setMany(pluginName: string, items: StorageSetManyItem[], options?: { atomic?: boolean }): StorageSetManyResult {
    if (items.length === 0) return { success: true, results: [] }
    const ns = nsKey(pluginName)
    const atomic = options?.atomic !== false // 默认 true

    if (atomic) {
      try {
        return setManyAtomicTransaction(ns, items)
      } catch (error) {
        const err = error as Error & { results?: StorageSetManyResultItem[] }
        if (err.results) return { success: false, results: err.results }
        throw error
      }
    }

    // 非原子模式：逐个执行
    const results: StorageSetManyResultItem[] = []
    let allOk = true
    for (const item of items) {
      const r = this._setOneWithVersion(ns, item.key, item.value, item.expectedVersion)
      if (!r.ok) allOk = false
      results.push({
        key: item.key,
        ok: r.ok,
        version: r.version,
        error: r.ok ? undefined : 'E_CONFLICT' as StorageErrorCode
      })
    }
    return { success: allOk, results }
  }

  // 获取值 + 元数据
  getMeta(pluginName: string, key: string): StorageMetaResult {
    const ns = nsKey(pluginName)
    const row = getMetaStmt.get(ns, key) as { value: string; version: number; updated_at: number } | undefined
    if (!row) return { found: false }
    let value: unknown
    try { value = JSON.parse(row.value) } catch { value = row.value }
    return { found: true, value, version: row.version ?? 0, updatedAt: row.updated_at }
  }

  // CAS 写入（乐观并发控制）
  setWithVersion(pluginName: string, key: string, value: unknown, expectedVersion?: number | null): StorageSetVersionResult {
    return this._setOneWithVersion(nsKey(pluginName), key, value, expectedVersion)
  }

  // CAS 删除
  removeWithVersion(pluginName: string, key: string, expectedVersion?: number): StorageRemoveVersionResult {
    const ns = nsKey(pluginName)
    if (expectedVersion === undefined) {
      // 无条件删除
      removeStmt.run(ns, key)
      return { ok: true }
    }
    const info = removeWithVersionStmt.run(ns, key, expectedVersion)
    if (info.changes === 0) {
      // 可能 key 不存在或 version 不匹配
      const existing = getMetaStmt.get(ns, key) as { version: number } | undefined
      if (!existing) return { ok: false, error: 'E_NOT_FOUND' }
      return { ok: false, error: 'E_CONFLICT' }
    }
    return { ok: true }
  }

  // 原子事务（混合 set/remove）
  transaction(pluginName: string, ops: StorageTransactionOp[]): StorageTransactionResult {
    if (ops.length === 0) return { success: true, committed: 0 }
    const ns = nsKey(pluginName)
    try {
      return transactionExec(ns, ops)
    } catch (error) {
      const err = error as Error & { result?: StorageTransactionResult }
      if (err.result) return err.result
      throw error
    }
  }

  // 向 JSON 数组追加元素
  append(pluginName: string, key: string, chunk: unknown, options?: StorageAppendOptions): StorageAppendResult {
    const ns = nsKey(pluginName)
    return appendExec(ns, key, chunk, options)
  }

  // ====== 内部方法 ======

  /** 单键 CAS 写入（内部复用） */
  _setOneWithVersion(ns: string, key: string, value: unknown, expectedVersion?: number | null): StorageSetVersionResult {
    const now = Date.now()
    const jsonValue = JSON.stringify(value)

    if (expectedVersion === null) {
      // 仅在 key 不存在时写入
      const info = casInsertOnlyStmt.run(ns, key, jsonValue, now)
      if (info.changes === 0) {
        const existing = getMetaStmt.get(ns, key) as { version: number } | undefined
        return { ok: false, conflict: { currentVersion: existing?.version ?? 0 } }
      }
      return { ok: true, version: 1 }
    }

    if (expectedVersion === undefined) {
      // 无条件写入（兼容 V1 行为）
      setStmt.run(ns, key, jsonValue, now)
      const row = getMetaStmt.get(ns, key) as { version: number } | undefined
      return { ok: true, version: row?.version ?? 1 }
    }

    // CAS: numeric expectedVersion means update-existing-only, never recreate a deleted key
    const info = casUpdateStmt.run(jsonValue, now, ns, key, expectedVersion)
    if (info.changes === 0) {
      const existing = getMetaStmt.get(ns, key) as { version: number } | undefined
      if (!existing) {
        // key does not exist: return conflict with version 0 (not-found)
        return { ok: false, conflict: { currentVersion: 0 } }
      }
      return { ok: false, conflict: { currentVersion: existing.version } }
    }
    // 获取写入后的版本号
    const updated = getMetaStmt.get(ns, key) as { version: number } | undefined
    return { ok: true, version: updated?.version ?? expectedVersion + 1 }
  }

  // ====== Raw 方法：IPC 层直接使用（namespace 已是完整标识符，无需 nsKey 前缀） ======

  /** 直接操作 namespace 的 list（供 IPC 使用） */
  listRaw(namespace: string, options: StorageListOptions = {}): StorageListResult {
    const prefix = options.prefix ?? ''
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500)
    const order = options.order ?? 'asc'
    const startsAfter = options.startsAfter
    const pattern = prefix ? `${prefix}%` : '%'

    let rows: Record<string, unknown>[]
    if (startsAfter !== undefined) {
      if (order === 'asc') {
        rows = listAscStmt.all(namespace, startsAfter, pattern, limit) as Record<string, unknown>[]
      } else {
        rows = listDescStmt.all(namespace, startsAfter, pattern, limit) as Record<string, unknown>[]
      }
    } else {
      if (order === 'asc') {
        rows = listAscNoCursorStmt.all(namespace, pattern, limit) as Record<string, unknown>[]
      } else {
        rows = listDescNoCursorStmt.all(namespace, pattern, limit) as Record<string, unknown>[]
      }
    }

    const items: StorageListItem[] = rows.map(r => ({
      key: r.key as string,
      size: (r.size ?? r['LENGTH(value)'] ?? 0) as number,
      updatedAt: (r.updatedAt ?? r.updated_at ?? 0) as number,
      version: (r.version ?? 0) as number
    }))

    const nextCursor = items.length === limit ? items[items.length - 1].key : undefined
    return { items, nextCursor }
  }

  /** 直接操作 namespace 的 getMany */
  getManyRaw(namespace: string, keys: string[]): StorageGetManyItem[] {
    if (keys.length === 0) return []
    return keys.map(key => {
      const row = getMetaStmt.get(namespace, key) as { value: string; version: number; updated_at: number } | undefined
      if (!row) return { key, found: false }
      let value: unknown
      try { value = JSON.parse(row.value) } catch { value = row.value }
      return { key, found: true, value, version: row.version ?? 0, updatedAt: row.updated_at }
    })
  }

  /** 直接操作 namespace 的 setMany */
  setManyRaw(namespace: string, items: StorageSetManyItem[], options?: { atomic?: boolean }): StorageSetManyResult {
    if (items.length === 0) return { success: true, results: [] }
    const atomic = options?.atomic !== false

    if (atomic) {
      try {
        return setManyAtomicTransaction(namespace, items)
      } catch (error) {
        const err = error as Error & { results?: StorageSetManyResultItem[]; conflicts?: Array<{ key: string; currentVersion: number }> }
        if (err.results) return { success: false, results: err.results }
        throw error
      }
    }

    const results: StorageSetManyResultItem[] = []
    let allOk = true
    for (const item of items) {
      const r = this._setOneWithVersion(namespace, item.key, item.value, item.expectedVersion)
      if (!r.ok) allOk = false
      results.push({ key: item.key, ok: r.ok, version: r.version, error: r.ok ? undefined : 'E_CONFLICT' as StorageErrorCode })
    }
    return { success: allOk, results }
  }

  /** 直接操作 namespace 的 getMeta */
  getMetaRaw(namespace: string, key: string): StorageMetaResult {
    const row = getMetaStmt.get(namespace, key) as { value: string; version: number; updated_at: number } | undefined
    if (!row) return { found: false }
    let value: unknown
    try { value = JSON.parse(row.value) } catch { value = row.value }
    return { found: true, value, version: row.version ?? 0, updatedAt: row.updated_at }
  }

  /** 直接操作 namespace 的 removeWithVersion */
  removeWithVersionRaw(namespace: string, key: string, expectedVersion?: number): StorageRemoveVersionResult {
    if (expectedVersion === undefined) {
      removeStmt.run(namespace, key)
      return { ok: true }
    }
    const info = removeWithVersionStmt.run(namespace, key, expectedVersion)
    if (info.changes === 0) {
      const existing = getMetaStmt.get(namespace, key) as { version: number } | undefined
      if (!existing) return { ok: false, error: 'E_NOT_FOUND' }
      return { ok: false, error: 'E_CONFLICT' }
    }
    return { ok: true }
  }

  /** 直接操作 namespace 的 transaction */
  transactionRaw(namespace: string, ops: StorageTransactionOp[]): StorageTransactionResult {
    if (ops.length === 0) return { success: true, committed: 0 }
    try {
      return transactionExec(namespace, ops)
    } catch (error) {
      const err = error as Error & { result?: StorageTransactionResult }
      if (err.result) return err.result
      throw error
    }
  }

  /** 直接操作 namespace 的 append */
  appendRaw(namespace: string, key: string, chunk: unknown, options?: StorageAppendOptions): StorageAppendResult {
    return appendExec(namespace, key, chunk, options)
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

        log.info(`[PluginStorage] 已迁移插件数据: ${pluginName} (${Object.keys(data).length} keys)`)
      } catch (err) {
        // 迁移失败不影响启动，保留原始 JSON 文件
        log.error(`[PluginStorage] 迁移失败: ${file}`, err)
      }
    }

    if (migratedCount > 0) {
      log.info(`[PluginStorage] 数据迁移完成: ${migratedCount} 个插件`)
    }
  }
}
