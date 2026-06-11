import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('storage attachment regression guards', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/ipc/storage.ts'), 'utf-8')

  it('uses filesystem-safe namespace directory names for attachment storage', () => {
    assert.match(source, /function safeAttachmentNamespace\(ns: string\): string/)
    assert.match(source, /encodeURIComponent\(ns\)/)
    assert.match(source, /plugin-attachments', safeAttachmentNamespace\(ns\)/)
  })

  it('keeps a legacy attachment directory fallback for existing stored files', () => {
    assert.match(source, /function getLegacyAttachmentDir\(ns: string\): string \| null/)
    assert.match(source, /\[getAttachmentDir\(ns, false\), getLegacyAttachmentDir\(ns\)\]/)
  })

  it('preserves Uint8Array slice boundaries when creating attachment buffers', () => {
    assert.match(source, /function toAttachmentBuffer/)
    assert.match(source, /Buffer\.from\(data\.buffer, data\.byteOffset, data\.byteLength\)/)
  })

  it('rejects colliding unsafe attachment identifiers instead of silently rewriting them', () => {
    assert.match(source, /function normalizeAttachmentId\(id: string\): string \| null/)
    assert.match(source, /return null/)
    assert.match(source, /if \(!safeId\) return false/)
  })

  it('broadcasts watch events for attachment and encrypted channels with a source discriminator', () => {
    assert.match(source, /broadcastStorageChange\(\{ type: 'set', key: safeId, namespace: ns, updatedAt: Date\.now\(\), source: 'attachment' \}\)/)
    assert.match(source, /broadcastStorageChange\(\{ type: 'remove', key: safeId, namespace: ns, updatedAt: Date\.now\(\), source: 'attachment' \}\)/)
    assert.match(source, /broadcastStorageChange\(\{ type: 'set', key, namespace: ns, updatedAt: Date\.now\(\), source: 'encrypted' \}\)/)
    assert.match(source, /broadcastStorageChange\(\{ type: 'remove', key, namespace: ns, updatedAt: Date\.now\(\), source: 'encrypted' \}\)/)
  })

  it('returns structured error codes from attachment put instead of a bare boolean', () => {
    assert.match(source, /Promise<AttachmentPutResult>/)
    assert.match(source, /return \{ ok: false, error: 'E_TOO_LARGE' \}/)
    assert.match(source, /return \{ ok: false, error: 'E_INVALID_ID' \}/)
    assert.match(source, /return \{ ok: false, error: 'E_IO' \}/)
    assert.match(source, /return \{ ok: false, error: 'E_META' \}/)
    assert.match(source, /return \{ ok: true \}/)
  })

  it('pre-checks attachment size in the preload before crossing IPC', () => {
    const preloadSource = readFileSync(join(process.cwd(), 'src/preload/apis/platform-api.ts'), 'utf-8')
    assert.match(preloadSource, /data\.byteLength > MAX_ATTACHMENT_SIZE/)
    assert.match(preloadSource, /Promise\.resolve\(\{ ok: false, error: 'E_TOO_LARGE' \}\)/)
    // 上限来自共享常量，避免 preload 与主进程阈值漂移
    assert.match(source, /import \{ MAX_ATTACHMENT_SIZE \} from '\.\.\/\.\.\/shared\/types\/storage-v2'/)
  })

  it('rejects Windows-hostile attachment identifiers (reserved names, control chars, trailing dot/space, oversized)', () => {
    // 控制字符（0x00-0x1F）
    assert.match(source, /\[\\x00-\\x1f\]/)
    // 结尾的点或空格（NTFS 会静默截断）
    assert.match(source, /\[ \.\]\$/)
    // Windows 保留设备名 CON/PRN/AUX/NUL/COM1-9/LPT1-9
    assert.match(source, /con\|prn\|aux\|nul\|com\[1-9\]\|lpt\[1-9\]/)
    assert.match(source, /WINDOWS_RESERVED_NAME\.test\(normalized\)/)
    // 文件名按字节计的长度上限
    assert.match(source, /Buffer\.byteLength\(normalized, 'utf8'\) > MAX_ATTACHMENT_ID_BYTES/)
  })

  it('guards reserved-prefix keys on every V2 IPC channel for plugin callers', () => {
    // 读路径：list 过滤、getMany 视为不存在、getMeta 拒绝
    assert.match(source, /result\.items\.filter\(item => !isReservedStorageKey\(item\.key\)\)/)
    assert.match(source, /result\.map\(item => isReservedStorageKey\(item\.key\) \? \{ key: item\.key, found: false \} : item\)/)
    assert.match(source, /if \(isReservedKeyBlocked\(caller, key\)\) return \{ found: false \}/)
    // 写路径：setWithVersion / removeWithVersion / append 单键拒绝
    assert.match(source, /if \(isReservedKeyBlocked\(caller, key\)\) return \{ ok: false, error: 'E_INVALID_KEY' \}/)
    assert.match(source, /if \(isReservedKeyBlocked\(caller, key\)\) return \{ ok: false, newLength: 0, version: 0 \}/)
    // 批量写：setMany / transaction 整批拒绝
    assert.match(source, /caller\.source === 'plugin' && items\.some\(it => isReservedStorageKey\(it\.key\)\)/)
    assert.match(source, /caller\.source === 'plugin' && ops\.some\(op => isReservedStorageKey\(op\.key\)\)/)
  })
})
