import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  createAuxiliaryLoadFileOptions,
  parseAuxiliaryPath,
  resolveLegacyAuxiliaryFileEntry,
  resolvePluginRelativeFile
} from '../window-path'

describe('auxiliary window path parsing', () => {
  it('normalizes route-only auxiliary paths to hash routes', () => {
    assert.deepEqual(parseAuxiliaryPath('overlay'), { hash: 'overlay' })
    assert.deepEqual(parseAuxiliaryPath('/overlay'), { hash: 'overlay' })
    assert.deepEqual(parseAuxiliaryPath('#overlay'), { hash: 'overlay' })
    assert.deepEqual(parseAuxiliaryPath('#/overlay'), { hash: 'overlay' })
  })

  it('splits legacy html, hash route, and query strings for loadFile', () => {
    assert.deepEqual(parseAuxiliaryPath('/index.html#overlay'), { hash: 'overlay' })
    assert.deepEqual(parseAuxiliaryPath('overlay?a=1&b=2'), { hash: 'overlay', search: '?a=1&b=2' })
    assert.deepEqual(parseAuxiliaryPath('/index.html#overlay?a=1'), { hash: 'overlay', search: '?a=1' })
    assert.deepEqual(parseAuxiliaryPath('/index.html?mode=pin&img=abc'), { search: '?mode=pin&img=abc' })
    assert.deepEqual(parseAuxiliaryPath('/index.html?mode=pin#overlay'), { hash: 'overlay', search: '?mode=pin' })
  })

  it('omits empty loadFile options', () => {
    assert.equal(createAuxiliaryLoadFileOptions(parseAuxiliaryPath('/index.html')), undefined)
  })
})

describe('legacy auxiliary file path parsing', () => {
  function withPluginFixture(run: (pluginPath: string) => void) {
    const pluginPath = mkdtempSync(join(tmpdir(), 'mulby-window-path-'))
    try {
      writeFileSync(join(pluginPath, 'countdown.html'), '<!doctype html>')
      const regionDir = join(pluginPath, 'region')
      const effectDir = join(pluginPath, 'effect')
      writeFileSync(join(pluginPath, 'file.js'), '')
      writeFileSync(join(pluginPath, 'file.cjs'), '')
      writeFileSync(join(pluginPath, 'not-html.js'), '')
      writeFileSync(join(pluginPath, 'not-preload.html'), '<!doctype html>')
      mkdirSync(regionDir)
      mkdirSync(effectDir)
      writeFileSync(join(regionDir, 'index.html'), '<!doctype html>')
      writeFileSync(join(effectDir, 'index.html'), '<!doctype html>')
      run(pluginPath)
    } finally {
      rmSync(pluginPath, { recursive: true, force: true })
    }
  }

  it('resolves plugin-local html files with query and hash load options', () => {
    withPluginFixture((pluginPath) => {
      assert.deepEqual(resolveLegacyAuxiliaryFileEntry(pluginPath, 'region/index.html?key=1'), {
        htmlPath: join(pluginPath, 'region/index.html'),
        loadFileOptions: { search: '?key=1' }
      })
      assert.deepEqual(resolveLegacyAuxiliaryFileEntry(pluginPath, 'effect/index.html#x'), {
        htmlPath: join(pluginPath, 'effect/index.html'),
        loadFileOptions: { hash: 'x' }
      })
      assert.deepEqual(resolveLegacyAuxiliaryFileEntry(pluginPath, 'countdown.html?second=3'), {
        htmlPath: join(pluginPath, 'countdown.html'),
        loadFileOptions: { search: '?second=3' }
      })
      assert.deepEqual(resolveLegacyAuxiliaryFileEntry(pluginPath, 'countdown.html?second=3#done'), {
        htmlPath: join(pluginPath, 'countdown.html'),
        loadFileOptions: { search: '?second=3', hash: 'done' }
      })
    })
  })

  it('rejects unsafe or unsupported legacy html entries', () => {
    withPluginFixture((pluginPath) => {
      assert.throws(() => resolveLegacyAuxiliaryFileEntry(pluginPath, '/countdown.html'), /Absolute paths/)
      assert.throws(() => resolveLegacyAuxiliaryFileEntry(pluginPath, '../secret.html'), /escapes plugin directory/)
      assert.throws(() => resolveLegacyAuxiliaryFileEntry(pluginPath, 'not-html.js'), /Unsupported file extension/)
      assert.throws(() => resolveLegacyAuxiliaryFileEntry(pluginPath, 'countdown.html\0x'), /NUL byte/)
      assert.throws(() => resolveLegacyAuxiliaryFileEntry(pluginPath, 'missing.html'), /does not exist/)
    })
  })

  it('resolves preload entries only inside the plugin with js/cjs extensions', () => {
    withPluginFixture((pluginPath) => {
      assert.equal(resolvePluginRelativeFile(pluginPath, 'file.js', ['.js', '.cjs']), join(pluginPath, 'file.js'))
      assert.equal(resolvePluginRelativeFile(pluginPath, 'file.cjs', ['.js', '.cjs']), join(pluginPath, 'file.cjs'))
      assert.throws(() => resolvePluginRelativeFile(pluginPath, '../evil.cjs', ['.js', '.cjs']), /escapes plugin directory/)
      assert.throws(() => resolvePluginRelativeFile(pluginPath, '/tmp/evil.cjs', ['.js', '.cjs']), /Absolute paths/)
      assert.throws(() => resolvePluginRelativeFile(pluginPath, 'not-preload.html', ['.js', '.cjs']), /Unsupported file extension/)
      assert.throws(() => resolvePluginRelativeFile(pluginPath, 'file.cjs\0', ['.js', '.cjs']), /NUL byte/)
    })
  })
})
