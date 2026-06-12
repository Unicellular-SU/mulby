import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeAttachmentId,
  ATTACHMENT_TMP_PREFIX,
  MAX_ATTACHMENT_ID_BYTES
} from '../_shared/attachment-id'

describe('normalizeAttachmentId', () => {
  it('accepts ordinary ids unchanged', () => {
    assert.equal(normalizeAttachmentId('avatar'), 'avatar')
    assert.equal(normalizeAttachmentId('img-2026.06.11.png'), 'img-2026.06.11.png')
    assert.equal(normalizeAttachmentId('中文附件'), '中文附件')
    assert.equal(normalizeAttachmentId('a b c'), 'a b c')
    assert.equal(normalizeAttachmentId('CONFIG'), 'CONFIG') // 不是保留名（前缀相同但更长）
    assert.equal(normalizeAttachmentId('COM10'), 'COM10') // COM10 不是保留设备名
  })

  it('rejects empty and dot ids', () => {
    assert.equal(normalizeAttachmentId(''), null)
    assert.equal(normalizeAttachmentId('.'), null)
    assert.equal(normalizeAttachmentId('..'), null)
  })

  it('rejects path separators and Windows reserved characters', () => {
    for (const id of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      assert.equal(normalizeAttachmentId(id), null, `should reject ${JSON.stringify(id)}`)
    }
  })

  it('rejects control characters', () => {
    assert.equal(normalizeAttachmentId('a\x00b'), null)
    assert.equal(normalizeAttachmentId('a\nb'), null)
    assert.equal(normalizeAttachmentId('a\tb'), null)
  })

  it('rejects Windows reserved device names regardless of case and extension', () => {
    for (const id of ['CON', 'con', 'Con', 'PRN', 'AUX', 'NUL', 'nul', 'COM1', 'com9', 'LPT1', 'lpt9', 'CON.txt', 'NUL.png', 'com1.zip']) {
      assert.equal(normalizeAttachmentId(id), null, `should reject ${JSON.stringify(id)}`)
    }
  })

  it('rejects trailing dots and surrounding whitespace (Windows silently truncates them)', () => {
    assert.equal(normalizeAttachmentId('file.'), null)
    assert.equal(normalizeAttachmentId('file.png.'), null)
    assert.equal(normalizeAttachmentId('file '), null)
    assert.equal(normalizeAttachmentId(' file'), null)
  })

  it('rejects ids longer than the byte limit', () => {
    const okAscii = 'a'.repeat(MAX_ATTACHMENT_ID_BYTES)
    assert.equal(normalizeAttachmentId(okAscii), okAscii)
    assert.equal(normalizeAttachmentId('a'.repeat(MAX_ATTACHMENT_ID_BYTES + 1)), null)
    // 多字节字符按 UTF-8 字节数计算（中文每字 3 字节）
    const tooLongCjk = '附'.repeat(Math.floor(MAX_ATTACHMENT_ID_BYTES / 3) + 1)
    assert.equal(normalizeAttachmentId(tooLongCjk), null)
  })

  it('rejects the reserved temp-file prefix used by atomic writes', () => {
    assert.equal(normalizeAttachmentId(`${ATTACHMENT_TMP_PREFIX}anything`), null)
    assert.equal(normalizeAttachmentId('.tmp-12345'), null)
    // 其它点开头 id 不受影响（向后兼容已有数据）
    assert.equal(normalizeAttachmentId('.hidden'), '.hidden')
  })
})
