import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { buildProjectEntry } from '../../plugin/plugin-project-utils'
import type { PluginProjectEntry } from '../../../shared/types/settings'

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'mb-add-'))
}

describe('buildProjectEntry (developer:addPluginProject 纯逻辑)', () => {
  it('single 目录（根含 manifest.json）→ type=single', async () => {
    const dir = await makeTmpDir()
    await writeFile(path.join(dir, 'manifest.json'), '{}')
    const r = buildProjectEntry(dir, 'added', [])
    assert.equal(r.ok, true)
    assert.ok(r.entry)
    assert.equal(r.entry!.type, 'single')
    assert.equal(r.entry!.source, 'added')
    assert.equal(r.entry!.path, path.resolve(dir))
    await rm(dir, { recursive: true, force: true })
  })

  it('collection 目录（无根 manifest.json）→ type=collection', async () => {
    const dir = await makeTmpDir()
    await mkdir(path.join(dir, 'child'))
    const r = buildProjectEntry(dir, 'imported', [])
    assert.equal(r.ok, true)
    assert.equal(r.entry!.type, 'collection')
    assert.equal(r.entry!.source, 'imported')
    await rm(dir, { recursive: true, force: true })
  })

  it('重复路径（含尾部斜杠差异）→ 返回冲突', async () => {
    const dir = await makeTmpDir()
    await writeFile(path.join(dir, 'manifest.json'), '{}')
    const existing: PluginProjectEntry[] = [
      {
        id: 'x',
        path: dir + path.sep,
        type: 'single',
        source: 'added',
        createdAt: 1
      }
    ]
    const r = buildProjectEntry(dir, 'added', existing)
    assert.equal(r.ok, false)
    assert.ok(/已存在/.test(r.error || ''))
    await rm(dir, { recursive: true, force: true })
  })

  it('不存在的目录 → ok=false', () => {
    const r = buildProjectEntry(path.join(os.tmpdir(), 'definitely-not-exist-xyz-123'), 'added', [])
    assert.equal(r.ok, false)
    assert.ok(/不存在/.test(r.error || ''))
  })

  it('非法来源 → 归一化为 added', async () => {
    const dir = await makeTmpDir()
    await writeFile(path.join(dir, 'manifest.json'), '{}')
    const r = buildProjectEntry(dir, 'bogus-source', [])
    assert.equal(r.ok, true)
    assert.equal(r.entry!.source, 'added')
    await rm(dir, { recursive: true, force: true })
  })
})
