import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { PluginLoader } from '../loader'

async function makeSinglePlugin(root: string) {
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    name: 'demo.single', version: '1.0.0', displayName: 'Demo', main: 'dist/main.js',
    features: [{ code: 'run', explain: 'r', cmds: [{ type: 'keyword', value: 'demo' }] }]
  }))
  await mkdir(path.join(root, 'dist'))
  await writeFile(path.join(root, 'dist', 'main.js'), 'module.exports={}')
}

describe('PluginLoader single dir', () => {
  it('loadPlugin loads a dir that directly contains manifest.json', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await makeSinglePlugin(dir)
    const loader = new PluginLoader(dir)
    const plugin = loader.loadPlugin(dir)
    assert.ok(plugin)
    assert.equal(plugin!.id, 'demo.single')
    await rm(dir, { recursive: true, force: true })
  })

  it('loadAll returns [] for a single-plugin dir (collection semantics)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await makeSinglePlugin(dir)
    const loader = new PluginLoader(dir)
    assert.equal(loader.loadAll().length, 0) // 证明单插件目录必须走 single 分支
    await rm(dir, { recursive: true, force: true })
  })
})
