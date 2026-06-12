import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ATTACHMENT_META_KEY_PREFIX,
  ENCRYPTED_KEY_PREFIX,
  EXCLUDE_INTERNAL_KEYS_SQL,
  isInternalStorageKey
} from '../storage-internal-keys'

describe('storage internal keys', () => {
  it('marks attachment meta and encrypted keys as internal', () => {
    assert.equal(isInternalStorageKey(`${ATTACHMENT_META_KEY_PREFIX}avatar`), true)
    assert.equal(isInternalStorageKey(`${ENCRYPTED_KEY_PREFIX}apiKey`), true)
  })

  it('keeps business keys (including lookalikes) visible', () => {
    assert.equal(isInternalStorageKey('myKey'), false)
    assert.equal(isInternalStorageKey('attachment_meta_:x'), false) // 缺少前导下划线
    assert.equal(isInternalStorageKey('xattachment_metaQ:x'), false)
    assert.equal(isInternalStorageKey('_encrypted:x'), false) // 缺少结尾下划线
  })

  it('escapes LIKE wildcards in the SQL filter so lookalike keys are not misclassified', () => {
    // `_` 是 LIKE 单字符通配符：必须以 `\_` 形式出现并声明 ESCAPE '\'
    assert.match(EXCLUDE_INTERNAL_KEYS_SQL, /\\_attachment\\_meta\\_:%/)
    assert.match(EXCLUDE_INTERNAL_KEYS_SQL, /\\_encrypted\\_:%/)
    assert.match(EXCLUDE_INTERNAL_KEYS_SQL, /ESCAPE '\\'/)
    // 不应残留未转义的内部键前缀（防止后续改动丢掉转义）
    assert.equal(EXCLUDE_INTERNAL_KEYS_SQL.includes("'_attachment_meta_:%'"), false)
    assert.equal(EXCLUDE_INTERNAL_KEYS_SQL.includes("'_encrypted_:%'"), false)
  })
})
