import { ipcMain, webContents } from 'electron'
import db from '../db'
import { PluginStorage } from '../plugin/storage'
import type {
    StorageListOptions,
    StorageSetManyItem,
    StorageSetManyOptions,
    StorageTransactionOp,
    StorageAppendOptions,
    StorageWatchEvent,
    StorageWatchOptions
} from '../../shared/types/storage-v2'

// 复用全局 PluginStorage 实例（V2 方法直接调用）
const pluginStorageForIpc = new PluginStorage()

export function registerStorageHandlers() {
    // get: 获取值
    const stmtGet = db.prepare('SELECT value FROM store WHERE plugin_id = ? AND key = ?')
    ipcMain.handle('storage:get', (_, key: string, namespace: string = 'global') => {
        try {
            const row = stmtGet.get(namespace, key) as { value: string } | undefined
            return row ? JSON.parse(row.value) : undefined
        } catch (error) {
            console.error(`[Storage] Get failed (${namespace}:${key}):`, error)
            return undefined
        }
    })

    // set: 设置值
    const stmtSet = db.prepare(`
    INSERT INTO store (plugin_id, key, value, updated_at, version)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(plugin_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at,
      version = version + 1
  `)
    ipcMain.handle('storage:set', (_, key: string, value: unknown, namespace: string = 'global') => {
        try {
            const jsonValue = JSON.stringify(value)
            stmtSet.run(namespace, key, jsonValue, Date.now())
            // 广播变更事件
            broadcastStorageChange({ type: 'set', key, namespace, updatedAt: Date.now() })
            return true
        } catch (error) {
            console.error(`[Storage] Set failed (${namespace}:${key}):`, error)
            return false
        }
    })

    // remove: 删除值
    const stmtRemove = db.prepare('DELETE FROM store WHERE plugin_id = ? AND key = ?')
    ipcMain.handle('storage:remove', (_, key: string, namespace: string = 'global') => {
        try {
            stmtRemove.run(namespace, key)
            broadcastStorageChange({ type: 'remove', key, namespace, updatedAt: Date.now() })
            return true
        } catch (error) {
            console.error(`[Storage] Remove failed (${namespace}:${key}):`, error)
            return false
        }
    })

    // getAll: 获取某命名空间下的所有数据
    const stmtGetAll = db.prepare('SELECT key, value FROM store WHERE plugin_id = ?')
    ipcMain.handle('storage:getAll', (_, namespace: string = 'global') => {
        try {
            const rows = stmtGetAll.all(namespace) as { key: string; value: string }[]
            const result: Record<string, unknown> = {}
            for (const row of rows) {
                result[row.key] = JSON.parse(row.value)
            }
            return result
        } catch (error) {
            console.error(`[Storage] GetAll failed (${namespace}):`, error)
            return {}
        }
    })

    // clear: 清空某命名空间下的所有数据
    const stmtClear = db.prepare('DELETE FROM store WHERE plugin_id = ?')
    ipcMain.handle('storage:clear', (_, namespace: string = 'global') => {
        try {
            stmtClear.run(namespace)
            broadcastStorageChange({ type: 'clear', key: '*', namespace, updatedAt: Date.now() })
            return true
        } catch (error) {
            console.error(`[Storage] Clear failed (${namespace}):`, error)
            return false
        }
    })

    // listNamespaces: 列出所有命名空间及统计信息
    const stmtListNamespaces = db.prepare(
        'SELECT plugin_id, COUNT(*) as count, MAX(updated_at) as lastUpdated FROM store GROUP BY plugin_id ORDER BY plugin_id'
    )
    ipcMain.handle('storage:listNamespaces', () => {
        try {
            return stmtListNamespaces.all() as { plugin_id: string; count: number; lastUpdated: number }[]
        } catch (error) {
            console.error('[Storage] ListNamespaces failed:', error)
            return []
        }
    })

    // getAllWithMeta: 获取某命名空间下所有键值对（含 updated_at 元数据）
    const stmtGetAllWithMeta = db.prepare(
        'SELECT key, value, updated_at FROM store WHERE plugin_id = ? ORDER BY key'
    )
    ipcMain.handle('storage:getAllWithMeta', (_, namespace: string) => {
        try {
            const rows = stmtGetAllWithMeta.all(namespace) as { key: string; value: string; updated_at: number }[]
            return rows.map(row => {
                let parsed: unknown
                try {
                    parsed = JSON.parse(row.value)
                } catch {
                    parsed = row.value
                }
                return { key: row.key, value: parsed, rawValue: row.value, updatedAt: row.updated_at }
            })
        } catch (error) {
            console.error(`[Storage] GetAllWithMeta failed (${namespace}):`, error)
            return []
        }
    })

    // ====== V2 扩展 handlers ======

    // list: 按前缀分页遍历
    ipcMain.handle('storage:list', (_, namespace: string = 'global', options: StorageListOptions = {}) => {
        try {
            // IPC 层直接操作 namespace，无需 nsKey 前缀
            return pluginStorageForIpc.listRaw(namespace, options)
        } catch (error) {
            console.error(`[Storage] List failed (${namespace}):`, error)
            return { items: [], nextCursor: undefined }
        }
    })

    // getMany: 批量读取
    ipcMain.handle('storage:getMany', (_, keys: string[], namespace: string = 'global') => {
        try {
            return pluginStorageForIpc.getManyRaw(namespace, keys)
        } catch (error) {
            console.error(`[Storage] GetMany failed (${namespace}):`, error)
            return keys.map(key => ({ key, found: false }))
        }
    })

    // setMany: 批量写入
    ipcMain.handle('storage:setMany', (_, items: StorageSetManyItem[], options: StorageSetManyOptions = {}, namespace: string = 'global') => {
        try {
            const result = pluginStorageForIpc.setManyRaw(namespace, items, options)
            // Broadcast each successful item (not gated on result.success)
            for (const r of result.results) {
                if (r.ok) {
                    broadcastStorageChange({ type: 'set', key: r.key, namespace, version: r.version, updatedAt: Date.now() })
                }
            }
            return result
        } catch (error) {
            console.error(`[Storage] SetMany failed (${namespace}):`, error)
            return { success: false, results: [] }
        }
    })

    // getMeta: 获取值 + 元数据
    ipcMain.handle('storage:getMeta', (_, key: string, namespace: string = 'global') => {
        try {
            return pluginStorageForIpc.getMetaRaw(namespace, key)
        } catch (error) {
            console.error(`[Storage] GetMeta failed (${namespace}:${key}):`, error)
            return { found: false }
        }
    })

    // setWithVersion: CAS 写入
    ipcMain.handle('storage:setWithVersion', (_, key: string, value: unknown, expectedVersion: number | null | undefined, namespace: string = 'global') => {
        try {
            const result = pluginStorageForIpc._setOneWithVersion(namespace, key, value, expectedVersion)
            if (result.ok) {
                broadcastStorageChange({ type: 'set', key, namespace, version: result.version, updatedAt: Date.now() })
            }
            return result
        } catch (error) {
            console.error(`[Storage] SetWithVersion failed (${namespace}:${key}):`, error)
            return { ok: false }
        }
    })

    // removeWithVersion: CAS 删除
    ipcMain.handle('storage:removeWithVersion', (_, key: string, expectedVersion: number | undefined, namespace: string = 'global') => {
        try {
            const result = pluginStorageForIpc.removeWithVersionRaw(namespace, key, expectedVersion)
            if (result.ok) {
                broadcastStorageChange({ type: 'remove', key, namespace, updatedAt: Date.now() })
            }
            return result
        } catch (error) {
            console.error(`[Storage] RemoveWithVersion failed (${namespace}:${key}):`, error)
            return { ok: false, error: 'E_INVALID_VALUE' }
        }
    })

    // transaction: 原子事务
    ipcMain.handle('storage:transaction', (_, ops: StorageTransactionOp[], namespace: string = 'global') => {
        try {
            const result = pluginStorageForIpc.transactionRaw(namespace, ops)
            if (result.success) {
                for (const op of ops) {
                    broadcastStorageChange({
                        type: op.op === 'set' ? 'set' : 'remove',
                        key: op.key,
                        namespace,
                        updatedAt: Date.now()
                    })
                }
            }
            return result
        } catch (error) {
            console.error(`[Storage] Transaction failed (${namespace}):`, error)
            const err = error as Error & { result?: unknown }
            if (err.result) return err.result
            return { success: false, committed: 0 }
        }
    })

    // append: 追加写入
    ipcMain.handle('storage:append', (_, key: string, chunk: unknown, options: StorageAppendOptions = {}, namespace: string = 'global') => {
        try {
            const result = pluginStorageForIpc.appendRaw(namespace, key, chunk, options)
            if (result.ok) {
                broadcastStorageChange({ type: 'set', key, namespace, version: result.version, updatedAt: Date.now() })
            }
            return result
        } catch (error) {
            console.error(`[Storage] Append failed (${namespace}:${key}):`, error)
            return { ok: false, newLength: 0, version: 0 }
        }
    })

    // ====== watch：变更订阅 ======

    ipcMain.handle('storage:watch', (event, options: StorageWatchOptions = {}) => {
        const watchId = ++watchIdCounter
        const wcId = event.sender.id
        const entry: WatchEntry = { wcId, namespace: options.namespace, prefix: options.prefix }
        watchRegistry.set(watchId, entry)
        // webContents destroyed -> auto-cleanup for all its watches
        event.sender.once('destroyed', () => {
            for (const [id, e] of watchRegistry) {
                if (e.wcId === wcId) watchRegistry.delete(id)
            }
        })
        return watchId
    })

    ipcMain.handle('storage:unwatch', (_, watchId: number) => {
        watchRegistry.delete(watchId)
        return true
    })
}

// ====== watch 广播机制 ======

/** Watch entry */
interface WatchEntry { wcId: number; namespace?: string; prefix?: string }

/** Per-call watch registry */
let watchIdCounter = 0
const watchRegistry = new Map<number, WatchEntry>()

/** Broadcast to all matching watchers */
function broadcastStorageChange(event: StorageWatchEvent): void {
    if (watchRegistry.size === 0) return

    for (const [watchId, filter] of watchRegistry) {
        if (filter.namespace && filter.namespace !== event.namespace) continue
        if (filter.prefix && !event.key.startsWith(filter.prefix)) continue

        try {
            const wc = webContents.fromId(filter.wcId)
            if (wc && !wc.isDestroyed()) {
                wc.send('storage:change', event)
            } else {
                watchRegistry.delete(watchId)
            }
        } catch {
            watchRegistry.delete(watchId)
        }
    }
}
