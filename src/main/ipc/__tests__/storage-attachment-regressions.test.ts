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
})
