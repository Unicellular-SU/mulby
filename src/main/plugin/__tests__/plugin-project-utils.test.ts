import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  isSinglePluginDir,
  detectProjectType,
  dedupeProjects,
  buildProjectEntry
} from '../plugin-project-utils'
import type { PluginProjectEntry } from '../../../shared/types/settings'

describe('plugin-project-utils', () => {
  it('isSinglePluginDir: true when manifest.json exists', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), '{}')
    assert.equal(isSinglePluginDir(dir), true)
    await rm(dir, { recursive: true, force: true })
  })

  it('detectProjectType: collection when no manifest.json at root', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await mkdir(path.join(dir, 'child'))
    assert.equal(detectProjectType(dir), 'collection')
    await rm(dir, { recursive: true, force: true })
  })

  it('detectProjectType: single when manifest.json at root', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), '{}')
    assert.equal(detectProjectType(dir), 'single')
    await rm(dir, { recursive: true, force: true })
  })

  it('dedupeProjects: removes duplicate resolved paths, keeps first', () => {
    const base: Omit<PluginProjectEntry, 'path'> = {
      id: 'a',
      type: 'single',
      source: 'added',
      createdAt: 1
    }
    const list: PluginProjectEntry[] = [
      { ...base, id: '1', path: '/tmp/p' },
      { ...base, id: '2', path: '/tmp/p/' }
    ]
    const out = dedupeProjects(list)
    assert.equal(out.length, 1)
    assert.equal(out[0].id, '1')
    assert.equal(out[0].path, path.resolve('/tmp/p'))
  })

  describe('buildProjectEntry', () => {
    it('returns conflict when path already exists in existing projects', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
      const existing: PluginProjectEntry[] = [
        { id: 'x', path: dir, type: 'collection', source: 'added', createdAt: 1 }
      ]
      const r = buildProjectEntry(dir, 'added', existing)
      assert.equal(r.ok, false)
      assert.ok(r.error && /已存在|exists/i.test(r.error))
      await rm(dir, { recursive: true, force: true })
    })

    it('builds single entry for a dir with manifest.json', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
      await writeFile(path.join(dir, 'manifest.json'), '{}')
      const r = buildProjectEntry(dir, 'imported', [])
      assert.equal(r.ok, true)
      assert.equal(r.entry!.type, 'single')
      assert.equal(r.entry!.source, 'imported')
      assert.equal(r.entry!.path, path.resolve(dir))
      await rm(dir, { recursive: true, force: true })
    })

    it('builds collection entry for a dir without manifest.json', async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
      await mkdir(path.join(dir, 'child'))
      const r = buildProjectEntry(dir, undefined, [])
      assert.equal(r.ok, true)
      assert.equal(r.entry!.type, 'collection')
      assert.equal(r.entry!.source, 'added')
      await rm(dir, { recursive: true, force: true })
    })

    it('returns error when directory does not exist', () => {
      const r = buildProjectEntry('/no/such/dir/xyz-123', 'added', [])
      assert.equal(r.ok, false)
      assert.ok(r.error)
    })
  })
})
