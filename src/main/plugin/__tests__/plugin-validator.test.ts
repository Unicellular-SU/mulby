import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { validatePluginAt } from '../plugin-validator'

describe('validatePluginAt', () => {
  it('reports missing manifest', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    const r = validatePluginAt(dir)
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => /manifest/i.test(e)))
    await rm(dir, { recursive: true, force: true })
  })

  it('reports invalid JSON', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), '{ not valid json')
    const r = validatePluginAt(dir)
    assert.equal(r.valid, false)
    assert.ok(r.errors.length > 0)
    await rm(dir, { recursive: true, force: true })
  })

  it('reports missing required fields', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'x' }))
    const r = validatePluginAt(dir)
    assert.equal(r.valid, false)
    assert.ok(r.errors.length > 0)
    await rm(dir, { recursive: true, force: true })
  })

  it('valid when manifest + main exist, reports built', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      name: 'ok', version: '1.0.0', displayName: 'OK', main: 'dist/main.js',
      features: [{ code: 'r', explain: 'r', cmds: [{ type: 'keyword', value: 'k' }] }]
    }))
    await mkdir(path.join(dir, 'dist'))
    await writeFile(path.join(dir, 'dist', 'main.js'), 'x')
    const r = validatePluginAt(dir)
    assert.equal(r.valid, true)
    assert.equal(r.built, true)
    assert.equal(r.mainEntryFound, true)
    assert.equal(r.manifest?.id, 'ok')
    assert.equal(r.manifest?.featureCount, 1)
    await rm(dir, { recursive: true, force: true })
  })

  it('invalid (not built) when manifest valid but main file missing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      name: 'nb', version: '1.0.0', displayName: 'NB', main: 'dist/main.js',
      features: [{ code: 'r', explain: 'r', cmds: [{ type: 'keyword', value: 'k' }] }]
    }))
    const r = validatePluginAt(dir)
    assert.equal(r.built, false)
    assert.equal(r.mainEntryFound, false)
    assert.equal(r.valid, false)
    await rm(dir, { recursive: true, force: true })
  })

  it('reports platform incompatibility', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    const otherPlatform = process.platform === 'darwin' ? 'win32' : 'darwin'
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      name: 'p', version: '1.0.0', displayName: 'P', main: 'dist/main.js', platform: otherPlatform,
      features: [{ code: 'r', explain: 'r', cmds: [{ type: 'keyword', value: 'k' }] }]
    }))
    await mkdir(path.join(dir, 'dist'))
    await writeFile(path.join(dir, 'dist', 'main.js'), 'x')
    const r = validatePluginAt(dir)
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => /平台|platform/i.test(e)))
    await rm(dir, { recursive: true, force: true })
  })

  it('warns on regex command missing match', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      name: 'rg', version: '1.0.0', displayName: 'RG', main: 'dist/main.js',
      features: [{ code: 'r', explain: 'r', cmds: [{ type: 'regex' }] }]
    }))
    await mkdir(path.join(dir, 'dist'))
    await writeFile(path.join(dir, 'dist', 'main.js'), 'x')
    const r = validatePluginAt(dir)
    assert.ok(r.warnings.some(w => /match/i.test(w)))
    await rm(dir, { recursive: true, force: true })
  })
})
