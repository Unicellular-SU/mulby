import { app, ipcMain, safeStorage, webContents } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { readFile, writeFile, rename, rm, readdir, stat } from 'fs/promises'
import { join } from 'path'
import db from '../db'
import { PluginStorage, isReservedStorageKey } from '../plugin/storage'
import type {
    StorageListOptions,
    StorageSetManyItem,
    StorageSetManyOptions,
    StorageTransactionOp,
    StorageAppendOptions,
    StorageWatchEvent,
    StorageWatchOptions,
    AttachmentPutResult
} from '../../shared/types/storage-v2'
import { MAX_ATTACHMENT_SIZE } from '../../shared/types/storage-v2'
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
 * 保留前缀键防护（插件来源）：
 *
 * `_encrypted_:` / `_attachment_meta_:` 由 storage.encrypted / storage.attachment
 * 通道独占管理。插件不能通过通用 KV 通道伪造附件元数据、读取或破坏加密密文；
 * 主应用（Plugin Storage Explorer 等管理工具）不受限制。
 */
function isReservedKeyBlocked(caller: IpcCallerInfo, key: string): boolean {
    if (caller.source !== 'plugin') return false
    if (!isReservedStorageKey(key)) return false
    log.warn(`[Storage] 拒绝插件 ${caller.pluginId} 通过通用 KV 通道访问保留键: ${key}`)
    return true
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

// ====== 附件/二进制存储：路径与工具 ======

/**
 * 原子写入用的临时文件后缀（保留后缀，normalizeAttachmentId 会拒绝以它结尾的 id）。
 * list / 统计会把残留 tmp 文件（写入中途崩溃遗留）过滤掉。
 */
const ATTACHMENT_TMP_SUFFIX = '.mulby-tmp'

function isAttachmentTmpFile(file: string): boolean {
    return file.endsWith(ATTACHMENT_TMP_SUFFIX)
}

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

/** 该 namespace 的所有附件目录（新 + legacy），不创建 */
function getExistingAttachmentDirs(ns: string): string[] {
    return [getAttachmentDir(ns, false), getLegacyAttachmentDir(ns)].filter((dir): dir is string => Boolean(dir))
}

/** 删除该 namespace 的所有附件文件（clear / 卸载清理用） */
async function removeAttachmentDirs(ns: string): Promise<void> {
    for (const dir of getExistingAttachmentDirs(ns)) {
        await rm(dir, { recursive: true, force: true })
    }
}

/**
 * Windows 保留设备名（不分大小写）：CON/PRN/AUX/NUL/COM1-9/LPT1-9。
 * 带扩展名同样非法（如 `CON.txt`），故匹配到名字后紧跟 `.` 或结尾即拒绝。
 */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/**
 * 附件 id 最大字节数（按 UTF-8 计）。最终落盘文件名就是 id，原子写临时名还会
 * 追加 `.<随机串>.mulby-tmp`（约 25 字节），留足余量避免触发 ENAMETOOLONG
 * （多数文件系统单段文件名上限 255 字节）。
 */
const MAX_ATTACHMENT_ID_BYTES = 200

function normalizeAttachmentId(id: string): string | null {
    const normalized = String(id || '')
    if (!normalized || normalized === '.' || normalized === '..') return null
    // 路径分隔符与 Windows 非法字符
    if (/[/\\:*?"<>|]/.test(normalized)) return null
    // 控制字符（0x00-0x1F，含 NUL / 换行等），多数文件系统不接受
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f]/.test(normalized)) return null
    // 结尾的点或空格：NTFS 会静默截断，导致 id 与实际落盘文件名不一致
    if (/[ .]$/.test(normalized)) return null
    // Windows 保留设备名
    if (WINDOWS_RESERVED_NAME.test(normalized)) return null
    // 原子写保留后缀，避免与真实附件撞名
    if (isAttachmentTmpFile(normalized)) return null
    // 文件名长度上限（按字节，兼容多字节字符）
    if (Buffer.byteLength(normalized, 'utf8') > MAX_ATTACHMENT_ID_BYTES) return null
    return normalized
}

function toAttachmentBuffer(data: ArrayBuffer | Buffer | Uint8Array): Buffer {
    if (Buffer.isBuffer(data)) return data
    if (data instanceof ArrayBuffer) return Buffer.from(data)
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

// ====== 插件数据统计 / 清理（供卸载流程使用） ======

export interface PluginDataStats {
    /** KV 条数（不含附件元数据键与加密项） */
    kvCount: number
    /** 加密项条数（storage.encrypted） */
    encryptedCount: number
    attachmentCount: number
    attachmentBytes: number
}

// `_` 是 LIKE 通配符，需转义后才能精确匹配保留前缀；加密项与附件元数据均不计入 kvCount
const stmtCountKv = db.prepare(
    "SELECT COUNT(*) as c FROM store WHERE plugin_id = ? AND key NOT LIKE '\\_attachment\\_meta\\_:%' ESCAPE '\\' AND key NOT LIKE '\\_encrypted\\_:%' ESCAPE '\\'"
)
const stmtCountEncrypted = db.prepare(
    "SELECT COUNT(*) as c FROM store WHERE plugin_id = ? AND key LIKE '\\_encrypted\\_:%' ESCAPE '\\'"
)
const stmtPurgeNamespace = db.prepare('DELETE FROM store WHERE plugin_id = ?')

/** 统计某 namespace 的 KV / 加密项 / 附件占用 */
export async function getNamespaceDataStats(ns: string): Promise<PluginDataStats> {
    let kvCount = 0
    let encryptedCount = 0
    try {
        kvCount = (stmtCountKv.get(ns) as { c: number } | undefined)?.c ?? 0
        encryptedCount = (stmtCountEncrypted.get(ns) as { c: number } | undefined)?.c ?? 0
    } catch (error) {
        log.error(`[Storage] CountKv failed (${ns}):`, error)
    }

    let attachmentCount = 0
    let attachmentBytes = 0
    const seen = new Set<string>()
    for (const dir of getExistingAttachmentDirs(ns)) {
        let files: string[]
        try {
            files = await readdir(dir)
        } catch {
            continue
        }
        for (const file of files) {
            if (seen.has(file)) continue
            seen.add(file)
            if (isAttachmentTmpFile(file)) continue
            try {
                const stats = await stat(join(dir, file))
                if (stats.isFile()) {
                    attachmentCount++
                    attachmentBytes += stats.size
                }
            } catch {
                // 文件可能在统计期间被删除，跳过
            }
        }
    }
    return { kvCount, encryptedCount, attachmentCount, attachmentBytes }
}

/** 彻底删除某 namespace 的所有数据（KV + 加密项 + 附件文件） */
export async function purgeNamespaceData(ns: string): Promise<void> {
    stmtPurgeNamespace.run(ns)
    await removeAttachmentDirs(ns)
}

export function registerStorageHandlers() {
    // get: 获取值
    const stmtGet = db.prepare('SELECT value FROM store WHERE plugin_id = ? AND key = ?')
    ipcMain.handle('storage:get', pluginAwareInvoke((caller, _event, key: string, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        if (isReservedKeyBlocked(caller, key)) return undefined
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
        if (isReservedKeyBlocked(caller, key)) return false
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
        if (isReservedKeyBlocked(caller, key)) return false
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
                if (caller.source === 'plugin' && isReservedStorageKey(row.key)) continue
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
    //
    // 注意：清空 KV 时会一并删除附件文件，否则 `_attachment_meta_:` 行被删后
    // 磁盘上会留下孤儿文件（attachment:list 仍会把它们列出来）。
    const stmtClear = db.prepare('DELETE FROM store WHERE plugin_id = ?')
    ipcMain.handle('storage:clear', pluginAwareInvoke(async (caller, _event, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            stmtClear.run(ns)
            await removeAttachmentDirs(ns)
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
            const result = pluginStorageForIpc.listRaw(ns, options)
            // 插件来源：过滤保留前缀键（nextCursor 基于过滤前的最后一行，分页不漏数据）
            if (caller.source === 'plugin') {
                return { ...result, items: result.items.filter(item => !isReservedStorageKey(item.key)) }
            }
            return result
        } catch (error) {
            log.error(`[Storage] List failed (${ns}):`, error)
            return { items: [], nextCursor: undefined }
        }
    }))

    // getMany: 批量读取
    ipcMain.handle('storage:getMany', pluginAwareInvoke((caller, _event, keys: string[], namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        try {
            const result = pluginStorageForIpc.getManyRaw(ns, keys)
            // 插件来源：保留前缀键一律视为不存在
            if (caller.source === 'plugin') {
                return result.map(item => isReservedStorageKey(item.key) ? { key: item.key, found: false } : item)
            }
            return result
        } catch (error) {
            log.error(`[Storage] GetMany failed (${ns}):`, error)
            return keys.map(key => ({ key, found: false }))
        }
    }))

    // setMany: 批量写入
    ipcMain.handle('storage:setMany', pluginAwareInvoke((caller, _event, items: StorageSetManyItem[], options: StorageSetManyOptions = {}, namespace?: string) => {
        const ns = resolveNs(caller, namespace)
        // 插件来源：禁止通过 setMany 写保留前缀键（整批拒绝，不做任何写入）
        if (caller.source === 'plugin' && items.some(it => isReservedStorageKey(it.key))) {
            log.warn(`[Storage] 拒绝插件 ${caller.pluginId} 通过 setMany 写保留键`)
            return {
                success: false,
                results: items.map(it => ({ key: it.key, ok: false, error: isReservedStorageKey(it.key) ? 'E_INVALID_KEY' as const : undefined }))
            }
        }
        try {
            const result = pluginStorageForIpc.setManyRaw(ns, items, options)
            for (const r of result.results) {
                // 保留前缀键不广播，避免内部键泄露到 watch 订阅者
                if (r.ok && !isReservedStorageKey(r.key)) {
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
        if (isReservedKeyBlocked(caller, key)) return { found: false }
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
        if (isReservedKeyBlocked(caller, key)) return { ok: false, error: 'E_INVALID_KEY' }
        try {
            const result = pluginStorageForIpc._setOneWithVersion(ns, key, value, expectedVersion)
            if (result.ok && !isReservedStorageKey(key)) {
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
        if (isReservedKeyBlocked(caller, key)) return { ok: false, error: 'E_INVALID_KEY' }
        try {
            const result = pluginStorageForIpc.removeWithVersionRaw(ns, key, expectedVersion)
            if (result.ok && !isReservedStorageKey(key)) {
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
        // 插件来源：禁止事务操作保留前缀键（整个事务拒绝）
        if (caller.source === 'plugin' && ops.some(op => isReservedStorageKey(op.key))) {
            log.warn(`[Storage] 拒绝插件 ${caller.pluginId} 通过 transaction 操作保留键`)
            return { success: false, committed: 0 }
        }
        try {
            const result = pluginStorageForIpc.transactionRaw(ns, ops)
            if (result.success) {
                for (const op of ops) {
                    if (isReservedStorageKey(op.key)) continue
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
        if (isReservedKeyBlocked(caller, key)) return { ok: false, newLength: 0, version: 0 }
        try {
            const result = pluginStorageForIpc.appendRaw(ns, key, chunk, options)
            if (result.ok && !isReservedStorageKey(key)) {
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
            // 广播逻辑键（非 `_encrypted_:` 前缀键），watch 订阅者用 source 区分通道
            broadcastStorageChange({ type: 'set', key, namespace: ns, updatedAt: Date.now(), source: 'encrypted' })
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
            broadcastStorageChange({ type: 'remove', key, namespace: ns, updatedAt: Date.now(), source: 'encrypted' })
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
    //
    // 文件读写统一走 fs/promises：附件最大 50MB，同步 I/O 会阻塞主进程
    // （卡住所有窗口的 UI 与其他 IPC）。

    // 返回结构化结果 { ok, error }（对齐 V2 KV）：调用方可区分超限 / id 非法 / I/O / meta 失败
    ipcMain.handle('storage:attachment:put', pluginAwareInvoke(async (caller, _event, id: string, data: ArrayBuffer | Buffer | Uint8Array, mimeType: string): Promise<AttachmentPutResult> => {
        const ns = resolveNs(caller, undefined)
        const buf = toAttachmentBuffer(data)
        if (buf.length > MAX_ATTACHMENT_SIZE) {
            log.error(`[Storage:attachment] Size exceeds limit (${buf.length} > ${MAX_ATTACHMENT_SIZE})`)
            return { ok: false, error: 'E_TOO_LARGE' }
        }
        const safeId = normalizeAttachmentId(id)
        if (!safeId) return { ok: false, error: 'E_INVALID_ID' }
        const dir = getAttachmentDir(ns)
        const finalPath = join(dir, safeId)
        // 原子写：先写 tmp 再同目录 rename，中途崩溃不会留下半截的目标文件
        const tmpPath = join(dir, `${safeId}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${ATTACHMENT_TMP_SUFFIX}`)
        try {
            await writeFile(tmpPath, buf)
            await rename(tmpPath, finalPath)
        } catch (error) {
            log.error(`[Storage:attachment] Put failed (${ns}:${id}):`, error)
            await rm(tmpPath, { force: true }).catch(() => {})
            return { ok: false, error: 'E_IO' }
        }
        try {
            stmtSet.run(ns, `_attachment_meta_:${safeId}`, JSON.stringify({ mimeType, size: buf.length }), Date.now())
            // 广播附件变更：key 为附件 id，watch 订阅者用 source='attachment' 区分通道
            broadcastStorageChange({ type: 'set', key: safeId, namespace: ns, updatedAt: Date.now(), source: 'attachment' })
            return { ok: true }
        } catch (error) {
            // meta 写失败回滚：删除本次写入的文件 + 旧 meta，避免文件与元数据不一致。
            // 注意：若本次是覆盖写，rename 已替换掉同 id 的旧附件，此处删除新文件后
            // 旧附件也不再存在——即回滚到「干净空态」而非旧值（牺牲旧数据换取一致性）。
            log.error(`[Storage:attachment] Put meta failed, rolling back (${ns}:${id}):`, error)
            await rm(finalPath, { force: true }).catch(() => {})
            try {
                stmtRemove.run(ns, `_attachment_meta_:${safeId}`)
            } catch {
                // 回滚 meta 失败只能依赖 list 的孤儿兜底
            }
            return { ok: false, error: 'E_META' }
        }
    }))

    ipcMain.handle('storage:attachment:get', pluginAwareInvoke(async (caller, _event, id: string) => {
        const ns = resolveNs(caller, undefined)
        try {
            const safeId = normalizeAttachmentId(id)
            if (!safeId) return null
            const dirs = [getAttachmentDir(ns, false), getLegacyAttachmentDir(ns)].filter((dir): dir is string => Boolean(dir))
            for (const dir of dirs) {
                try {
                    return await readFile(join(dir, safeId))
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
                }
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

    ipcMain.handle('storage:attachment:remove', pluginAwareInvoke(async (caller, _event, id: string) => {
        const ns = resolveNs(caller, undefined)
        try {
            const safeId = normalizeAttachmentId(id)
            if (!safeId) return false
            const dirs = [getAttachmentDir(ns, false), getLegacyAttachmentDir(ns)].filter((dir): dir is string => Boolean(dir))
            for (const dir of dirs) {
                await rm(join(dir, safeId), { force: true })
            }
            stmtRemove.run(ns, `_attachment_meta_:${safeId}`)
            broadcastStorageChange({ type: 'remove', key: safeId, namespace: ns, updatedAt: Date.now(), source: 'attachment' })
            return true
        } catch (error) {
            log.error(`[Storage:attachment] Remove failed (${ns}:${id}):`, error)
            return false
        }
    }))

    ipcMain.handle('storage:attachment:list', pluginAwareInvoke(async (caller, _event, prefix?: string) => {
        const ns = resolveNs(caller, undefined)
        try {
            const dirs = [getAttachmentDir(ns, false), getLegacyAttachmentDir(ns)].filter((dir): dir is string => Boolean(dir))
            const files = new Set<string>()
            for (const dir of dirs) {
                try {
                    for (const file of await readdir(dir)) files.add(file)
                } catch {
                    // 目录不存在则跳过
                }
            }
            const results: { id: string; mimeType: string; size: number }[] = []
            for (const file of files) {
                if (isAttachmentTmpFile(file)) continue
                if (prefix && !file.startsWith(prefix)) continue
                const metaRow = stmtGet.get(ns, `_attachment_meta_:${file}`) as { value: string } | undefined
                if (metaRow) {
                    const meta = JSON.parse(metaRow.value) as { mimeType: string; size: number }
                    results.push({ id: file, mimeType: meta.mimeType, size: meta.size })
                } else {
                    // 无元数据的孤儿文件：单文件容错，stat 失败不影响整体列表
                    for (const dir of dirs) {
                        try {
                            const stats = await stat(join(dir, file))
                            if (stats.isFile()) {
                                results.push({ id: file, mimeType: 'application/octet-stream', size: stats.size })
                                break // 找到文件即停；若同名是目录则继续查其它目录
                            }
                        } catch {
                            // 该目录下不存在，尝试下一个
                        }
                    }
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
