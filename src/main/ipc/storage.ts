import { app, ipcMain, safeStorage, webContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
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
import {
    appOnlyInvoke,
    pluginAwareInvoke,
    resolveStorageNamespace,
    IpcPolicyError
} from './_shared/caller-middleware'
import type { IpcCallerInfo } from '../services/ipc-caller-resolver'
import log from 'electron-log'

// 复用全局 PluginStorage 实例（V2 方法直接调用）
const pluginStorageForIpc = new PluginStorage()

/**
 * 插件 namespace 越权保护：
 *
 * 所有 storage:* IPC 通道在插件来源下，都会忽略 renderer 传入的 namespace
 * 强制使用 `plugin:${pluginId}` 前缀（与 PluginStorage/api.ts 保持一致）。
 * 详见 `docs/code-review-architecture-2026-04-17.md` H1 与 M2。
 */
function resolveNs(caller: IpcCallerInfo, rawNamespace?: string): string {
    return resolveStorageNamespace(caller, rawNamespace)
}

/**
 * 一些聚合/管理类操作（listNamespaces、跨 namespace clear 等）只对主应用开放，
 * 否则插件可以枚举甚至清空其它插件的数据。
 */
function ensureAppCaller(caller: IpcCallerInfo, channel: string): void {
    if (caller.source !== 'app') {
        throw new IpcPolicyError(`storage:${channel} 仅主应用可调用（source=${caller.source}）`)
    }
}

export function registerStorageHandlers() {
    // get: 获取值
    const stmtGet = db.prepare('SELECT value FROM store WHERE plugin_id = ? AND key = ?')
    ipcMain.handle('storage:get', pluginAwareInvoke((caller, _event, key: string, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            const row = stmtGet.get(ns, key) as { value: string } | undefined
            return row ? JSON.parse(row.value) : undefined
        } catch (error) {
            log.error(`[Storage] Get failed (${ns}:${key}):`, error)
            return undefined
        }
    }))

    // set: 设置值
    const stmtSet = db.prepare(`
    INSERT INTO store (plugin_id, key, value, updated_at, version)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(plugin_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at,
      version = version + 1
  `)
    ipcMain.handle('storage:set', pluginAwareInvoke((caller, _event, key: string, value: unknown, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            const jsonValue = JSON.stringify(value)
            stmtSet.run(ns, key, jsonValue, Date.now())
            broadcastStorageChange({ type: 'set', key, namespace: ns, updatedAt: Date.now() })
            return true
        } catch (error) {
            log.error(`[Storage] Set failed (${ns}:${key}):`, error)
            return false
        }
    }))

    // remove: 删除值
    const stmtRemove = db.prepare('DELETE FROM store WHERE plugin_id = ? AND key = ?')
    ipcMain.handle('storage:remove', pluginAwareInvoke((caller, _event, key: string, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            stmtRemove.run(ns, key)
            broadcastStorageChange({ type: 'remove', key, namespace: ns, updatedAt: Date.now() })
            return true
        } catch (error) {
            log.error(`[Storage] Remove failed (${ns}:${key}):`, error)
            return false
        }
    }))

    // getAll: 获取某命名空间下的所有数据
    const stmtGetAll = db.prepare('SELECT key, value FROM store WHERE plugin_id = ?')
    ipcMain.handle('storage:getAll', pluginAwareInvoke((caller, _event, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            const rows = stmtGetAll.all(ns) as { key: string; value: string }[]
            const result: Record<string, unknown> = {}
            for (const row of rows) {
                result[row.key] = JSON.parse(row.value)
            }
            return result
        } catch (error) {
            log.error(`[Storage] GetAll failed (${ns}):`, error)
            return {}
        }
    }))

    // clear: 清空某命名空间下的所有数据
    //
    // 插件来源：只能清空自己的 `plugin:${pluginId}` namespace（由 resolveNs 强制）
    // 主应用：可以清空任意 namespace（设置中心的 Plugin Storage Explorer 用到）
    const stmtClear = db.prepare('DELETE FROM store WHERE plugin_id = ?')
    ipcMain.handle('storage:clear', pluginAwareInvoke((caller, _event, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            stmtClear.run(ns)
            broadcastStorageChange({ type: 'clear', key: '*', namespace: ns, updatedAt: Date.now() })
            return true
        } catch (error) {
            log.error(`[Storage] Clear failed (${ns}):`, error)
            return false
        }
    }))

    // listNamespaces: 列出所有命名空间及统计信息（管理类接口 → app-only）
    const stmtListNamespaces = db.prepare(
        'SELECT plugin_id, COUNT(*) as count, MAX(updated_at) as lastUpdated FROM store GROUP BY plugin_id ORDER BY plugin_id'
    )
    ipcMain.handle('storage:listNamespaces', appOnlyInvoke(() => {
        try {
            return stmtListNamespaces.all() as { plugin_id: string; count: number; lastUpdated: number }[]
        } catch (error) {
            log.error('[Storage] ListNamespaces failed:', error)
            return []
        }
    }))

    // getAllWithMeta: 获取某命名空间下所有键值对（含 updated_at 元数据）
    //
    // 任意 namespace 读取属于管理类接口（Plugin Storage Explorer 用），
    // 插件来源一律拒绝；插件要读自己的数据请用 storage:getAll / list
    const stmtGetAllWithMeta = db.prepare(
        'SELECT key, value, updated_at FROM store WHERE plugin_id = ? ORDER BY key'
    )
    ipcMain.handle('storage:getAllWithMeta', pluginAwareInvoke((caller, _event, namespace: string) => {
        ensureAppCaller(caller, 'getAllWithMeta')
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
            log.error(`[Storage] GetAllWithMeta failed (${namespace}):`, error)
            return []
        }
    }))

    // ====== V2 扩展 handlers ======

    // list: 按前缀分页遍历
    ipcMain.handle('storage:list', pluginAwareInvoke((caller, _event, namespace: string | undefined, options: StorageListOptions = {}) => {
        const ns = resolveNs(caller, namespace)
        try {
            return pluginStorageForIpc.listRaw(ns, options)
        } catch (error) {
            log.error(`[Storage] List failed (${ns}):`, error)
            return { items: [], nextCursor: undefined }
        }
    }))

    // getMany: 批量读取
    ipcMain.handle('storage:getMany', pluginAwareInvoke((caller, _event, keys: string[], namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            return pluginStorageForIpc.getManyRaw(ns, keys)
        } catch (error) {
            log.error(`[Storage] GetMany failed (${ns}):`, error)
            return keys.map(key => ({ key, found: false }))
        }
    }))

    // setMany: 批量写入
    ipcMain.handle('storage:setMany', pluginAwareInvoke((caller, _event, items: StorageSetManyItem[], options: StorageSetManyOptions = {}, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            const result = pluginStorageForIpc.setManyRaw(ns, items, options)
            for (const r of result.results) {
                if (r.ok) {
                    broadcastStorageChange({ type: 'set', key: r.key, namespace: ns, version: r.version, updatedAt: Date.now() })
                }
            }
            return result
        } catch (error) {
            log.error(`[Storage] SetMany failed (${ns}):`, error)
            return { success: false, results: [] }
        }
    }))

    // getMeta: 获取值 + 元数据
    ipcMain.handle('storage:getMeta', pluginAwareInvoke((caller, _event, key: string, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            return pluginStorageForIpc.getMetaRaw(ns, key)
        } catch (error) {
            log.error(`[Storage] GetMeta failed (${ns}:${key}):`, error)
            return { found: false }
        }
    }))

    // setWithVersion: CAS 写入
    ipcMain.handle('storage:setWithVersion', pluginAwareInvoke((caller, _event, key: string, value: unknown, expectedVersion: number | null | undefined, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            const result = pluginStorageForIpc._setOneWithVersion(ns, key, value, expectedVersion)
            if (result.ok) {
                broadcastStorageChange({ type: 'set', key, namespace: ns, version: result.version, updatedAt: Date.now() })
            }
            return result
        } catch (error) {
            log.error(`[Storage] SetWithVersion failed (${ns}:${key}):`, error)
            return { ok: false }
        }
    }))

    // removeWithVersion: CAS 删除
    ipcMain.handle('storage:removeWithVersion', pluginAwareInvoke((caller, _event, key: string, expectedVersion: number | undefined, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            const result = pluginStorageForIpc.removeWithVersionRaw(ns, key, expectedVersion)
            if (result.ok) {
                broadcastStorageChange({ type: 'remove', key, namespace: ns, updatedAt: Date.now() })
            }
            return result
        } catch (error) {
            log.error(`[Storage] RemoveWithVersion failed (${ns}:${key}):`, error)
            return { ok: false, error: 'E_INVALID_VALUE' }
        }
    }))

    // transaction: 原子事务
    ipcMain.handle('storage:transaction', pluginAwareInvoke((caller, _event, ops: StorageTransactionOp[], namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            const result = pluginStorageForIpc.transactionRaw(ns, ops)
            if (result.success) {
                for (const op of ops) {
                    broadcastStorageChange({
                        type: op.op === 'set' ? 'set' : 'remove',
                        key: op.key,
                        namespace: ns,
                        updatedAt: Date.now()
                    })
                }
            }
            return result
        } catch (error) {
            log.error(`[Storage] Transaction failed (${ns}):`, error)
            const err = error as Error & { result?: unknown }
            if (err.result) return err.result
            return { success: false, committed: 0 }
        }
    }))

    // append: 追加写入
    ipcMain.handle('storage:append', pluginAwareInvoke((caller, _event, key: string, chunk: unknown, options: StorageAppendOptions = {}, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            const result = pluginStorageForIpc.appendRaw(ns, key, chunk, options)
            if (result.ok) {
                broadcastStorageChange({ type: 'set', key, namespace: ns, version: result.version, updatedAt: Date.now() })
            }
            return result
        } catch (error) {
            log.error(`[Storage] Append failed (${ns}:${key}):`, error)
            return { ok: false, newLength: 0, version: 0 }
        }
    }))

    // ====== watch：变更订阅 ======

    ipcMain.handle('storage:watch', pluginAwareInvoke((caller, event, options: StorageWatchOptions = {}) => {
        const watchId = ++watchIdCounter
        const wcId = event.sender.id
        // 插件来源：watch 的 namespace 也强制锁在自己的 namespace，
        // 否则即使读/写做了隔离，插件仍能被动监听别人的 storage 变更
        const resolvedNs = options.namespace !== undefined
            ? resolveNs(caller, options.namespace)
            : (caller.source === 'plugin' && caller.pluginId
                ? resolveNs(caller, undefined)
                : undefined)
        const entry: WatchEntry = { wcId, namespace: resolvedNs, prefix: options.prefix }
        watchRegistry.set(watchId, entry)
        // webContents destroyed -> auto-cleanup for all its watches
        event.sender.once('destroyed', () => {
            for (const [id, e] of watchRegistry) {
                if (e.wcId === wcId) watchRegistry.delete(id)
            }
        })
        return watchId
    }))

    ipcMain.handle('storage:unwatch', pluginAwareInvoke((_caller, event, watchId: number) => {
        // 只允许 watchId 的拥有者取消订阅，防止插件 A 把插件 B 的 watchId 删掉
        const entry = watchRegistry.get(watchId)
        if (!entry) return true
        if (entry.wcId !== event.sender.id) {
            log.warn('[Storage] unwatch 拒绝：watchId 不属于当前 webContents')
            return false
        }
        watchRegistry.delete(watchId)
        return true
    }))

    // ====== 加密存储 (storage.encrypted) ======
    const ENC_PREFIX = '\x00enc:'

    ipcMain.handle('storage:encrypted:set', pluginAwareInvoke((caller, _event, key: string, value: unknown) => {
        const ns = resolveNs(caller, undefined)
        if (!safeStorage.isEncryptionAvailable()) {
            log.error('[Storage:encrypted] safeStorage not available')
            return false
        }
        try {
            const jsonStr = JSON.stringify(value)
            const encrypted = safeStorage.encryptString(jsonStr)
            const storedValue = ENC_PREFIX + encrypted.toString('base64')
            stmtSet.run(ns, `_encrypted_:${key}`, JSON.stringify(storedValue), Date.now())
            return true
        } catch (error) {
            log.error(`[Storage:encrypted] Set failed (${ns}:${key}):`, error)
            return false
        }
    }))

    ipcMain.handle('storage:encrypted:get', pluginAwareInvoke((caller, _event, key: string) => {
        const ns = resolveNs(caller, undefined)
        if (!safeStorage.isEncryptionAvailable()) {
            return undefined
        }
        try {
            const row = stmtGet.get(ns, `_encrypted_:${key}`) as { value: string } | undefined
            if (!row) return undefined
            const stored = JSON.parse(row.value) as string
            if (!stored.startsWith(ENC_PREFIX)) return undefined
            const encrypted = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
            const decrypted = safeStorage.decryptString(encrypted)
            return JSON.parse(decrypted)
        } catch (error) {
            log.error(`[Storage:encrypted] Get failed (${ns}:${key}):`, error)
            return undefined
        }
    }))

    ipcMain.handle('storage:encrypted:remove', pluginAwareInvoke((caller, _event, key: string) => {
        const ns = resolveNs(caller, undefined)
        try {
            stmtRemove.run(ns, `_encrypted_:${key}`)
            return true
        } catch (error) {
            log.error(`[Storage:encrypted] Remove failed (${ns}:${key}):`, error)
            return false
        }
    }))

    ipcMain.handle('storage:encrypted:has', pluginAwareInvoke((caller, _event, key: string) => {
        const ns = resolveNs(caller, undefined)
        try {
            const row = stmtGet.get(ns, `_encrypted_:${key}`) as { value: string } | undefined
            return row !== undefined
        } catch {
            return false
        }
    }))

    // ====== 附件/二进制存储 (storage.attachment) ======
    const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024 // 50MB

    function safeAttachmentNamespace(ns: string): string {
        return encodeURIComponent(ns)
    }

    function getAttachmentDir(ns: string, create = true): string {
        const dir = join(app.getPath('userData'), 'plugin-attachments', safeAttachmentNamespace(ns))
        if (create && !existsSync(dir)) mkdirSync(dir, { recursive: true })
        return dir
    }

    function getLegacyAttachmentDir(ns: string): string | null {
        const legacyDir = join(app.getPath('userData'), 'plugin-attachments', ns)
        return legacyDir === getAttachmentDir(ns, false) ? null : legacyDir
    }

    function normalizeAttachmentId(id: string): string | null {
        const normalized = String(id || '')
        if (!normalized || normalized === '.' || normalized === '..') return null
        if (/[/\\:*?"<>|]/.test(normalized)) return null
        return normalized
    }

    function toAttachmentBuffer(data: ArrayBuffer | Buffer | Uint8Array): Buffer {
        if (Buffer.isBuffer(data)) return data
        if (data instanceof ArrayBuffer) return Buffer.from(data)
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    }

    ipcMain.handle('storage:attachment:put', pluginAwareInvoke((caller, _event, id: string, data: ArrayBuffer | Buffer | Uint8Array, mimeType: string) => {
        const ns = resolveNs(caller, undefined)
        const buf = toAttachmentBuffer(data)
        if (buf.length > MAX_ATTACHMENT_SIZE) {
            log.error(`[Storage:attachment] Size exceeds limit (${buf.length} > ${MAX_ATTACHMENT_SIZE})`)
            return false
        }
        try {
            const dir = getAttachmentDir(ns)
            const safeId = normalizeAttachmentId(id)
            if (!safeId) return false
            writeFileSync(join(dir, safeId), buf)
            stmtSet.run(ns, `_attachment_meta_:${safeId}`, JSON.stringify({ mimeType, size: buf.length }), Date.now())
            return true
        } catch (error) {
            log.error(`[Storage:attachment] Put failed (${ns}:${id}):`, error)
            return false
        }
    }))

    ipcMain.handle('storage:attachment:get', pluginAwareInvoke((caller, _event, id: string) => {
        const ns = resolveNs(caller, undefined)
        try {
            const safeId = normalizeAttachmentId(id)
            if (!safeId) return null
            const dirs = [getAttachmentDir(ns, false), getLegacyAttachmentDir(ns)].filter((dir): dir is string => Boolean(dir))
            for (const dir of dirs) {
                const filePath = join(dir, safeId)
                if (existsSync(filePath)) return readFileSync(filePath)
            }
            return null
        } catch (error) {
            log.error(`[Storage:attachment] Get failed (${ns}:${id}):`, error)
            return null
        }
    }))

    ipcMain.handle('storage:attachment:getType', pluginAwareInvoke((caller, _event, id: string) => {
        const ns = resolveNs(caller, undefined)
        try {
            const safeId = normalizeAttachmentId(id)
            if (!safeId) return null
            const row = stmtGet.get(ns, `_attachment_meta_:${safeId}`) as { value: string } | undefined
            if (!row) return null
            const meta = JSON.parse(row.value) as { mimeType: string }
            return meta.mimeType
        } catch {
            return null
        }
    }))

    ipcMain.handle('storage:attachment:remove', pluginAwareInvoke((caller, _event, id: string) => {
        const ns = resolveNs(caller, undefined)
        try {
            const safeId = normalizeAttachmentId(id)
            if (!safeId) return false
            const dirs = [getAttachmentDir(ns, false), getLegacyAttachmentDir(ns)].filter((dir): dir is string => Boolean(dir))
            for (const dir of dirs) {
                const filePath = join(dir, safeId)
                if (existsSync(filePath)) unlinkSync(filePath)
            }
            stmtRemove.run(ns, `_attachment_meta_:${safeId}`)
            return true
        } catch (error) {
            log.error(`[Storage:attachment] Remove failed (${ns}:${id}):`, error)
            return false
        }
    }))

    ipcMain.handle('storage:attachment:list', pluginAwareInvoke((caller, _event, prefix?: string) => {
        const ns = resolveNs(caller, undefined)
        try {
            const dirs = [getAttachmentDir(ns, false), getLegacyAttachmentDir(ns)]
                .filter((dir): dir is string => Boolean(dir))
                .filter(dir => existsSync(dir))
            const files = Array.from(new Set(dirs.flatMap(dir => readdirSync(dir))))
            const results: { id: string; mimeType: string; size: number }[] = []
            for (const file of files) {
                if (prefix && !file.startsWith(prefix)) continue
                const metaRow = stmtGet.get(ns, `_attachment_meta_:${file}`) as { value: string } | undefined
                if (metaRow) {
                    const meta = JSON.parse(metaRow.value) as { mimeType: string; size: number }
                    results.push({ id: file, mimeType: meta.mimeType, size: meta.size })
                } else {
                    const existingDir = dirs.find(dir => existsSync(join(dir, file)))
                    if (!existingDir) continue
                    const filePath = join(existingDir, file)
                    const stats = statSync(filePath)
                    results.push({ id: file, mimeType: 'application/octet-stream', size: stats.size })
                }
            }
            return results
        } catch (error) {
            log.error(`[Storage:attachment] List failed (${ns}):`, error)
            return []
        }
    }))
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
