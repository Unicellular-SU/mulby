import { ipcMain } from 'electron'
import db from '../db'

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
    INSERT OR REPLACE INTO store (plugin_id, key, value, updated_at)
    VALUES (?, ?, ?, ?)
  `)
    ipcMain.handle('storage:set', (_, key: string, value: unknown, namespace: string = 'global') => {
        try {
            const jsonValue = JSON.stringify(value)
            stmtSet.run(namespace, key, jsonValue, Date.now())
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
}
