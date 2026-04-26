import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { materializeDataUrlImageAttachments } from '../input-attachments'
import type { InputPayload } from '../../../shared/types/plugin'

const ONE_PIXEL_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAwMBAd0X4n4AAAAASUVORK5CYII='

describe('input attachment materialization', () => {
  it('writes clipboard image data URLs to temp files while preserving the data URL', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'mulby-attachments-test-'))
    t.after(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    const input: InputPayload = {
      text: '',
      attachments: [{
        id: 'image-1',
        name: 'clipboard.png',
        size: 0,
        kind: 'image',
        dataUrl: ONE_PIXEL_PNG_DATA_URL
      }]
    }

    const result = await materializeDataUrlImageAttachments(input, dir)
    const attachment = result.attachments[0]

    assert.equal(attachment.kind, 'image')
    assert.equal(attachment.mime, 'image/png')
    assert.equal(attachment.ext, '.png')
    assert.equal(attachment.dataUrl, ONE_PIXEL_PNG_DATA_URL)
    assert.ok(attachment.path?.startsWith(dir))
    assert.ok(attachment.size > 0)

    const written = await readFile(attachment.path!)
    assert.ok(written.length > 0)
    await stat(attachment.path!)
  })

  it('leaves existing path attachments unchanged', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'mulby-attachments-test-'))
    t.after(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    const input: InputPayload = {
      text: '',
      attachments: [{
        id: 'image-2',
        name: 'photo.png',
        size: 128,
        kind: 'image',
        path: '/tmp/photo.png',
        dataUrl: ONE_PIXEL_PNG_DATA_URL
      }]
    }

    const result = await materializeDataUrlImageAttachments(input, dir)
    assert.equal(result, input)
    assert.deepEqual(result.attachments, input.attachments)
  })
})
