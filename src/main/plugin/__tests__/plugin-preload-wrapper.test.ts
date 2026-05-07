import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const electronModulePath = require.resolve('electron')
const electronLogModulePath = require.resolve('electron-log')
const originalElectronExport = require.cache[electronModulePath]?.exports
const originalElectronLogExport = require.cache[electronLogModulePath]?.exports
const userDataPath = mkdtempSync(join(tmpdir(), 'mulby-preload-cache-'))

function installModuleMock(modulePath: string, exportsValue: unknown): void {
  ;(require.cache as Record<string, NodeJS.Module | undefined>)[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
    children: [],
    paths: [],
    parent: null,
    path: '',
    require,
    isPreloading: false
  } as unknown as NodeJS.Module
}

installModuleMock(electronModulePath, {
    app: {
      getPath: () => userDataPath
    }
})
installModuleMock(electronLogModulePath, {
  info: () => {},
  warn: () => {},
  error: () => {}
})

type PreloadWrapperModule = typeof import('../plugin-preload-wrapper')
let preloadWrapperPromise: Promise<PreloadWrapperModule> | null = null

async function loadPreloadWrapper(): Promise<PreloadWrapperModule> {
  preloadWrapperPromise ??= import('../plugin-preload-wrapper').then((module) => {
    const wrapped = module as unknown as { default?: PreloadWrapperModule } & PreloadWrapperModule
    return wrapped.default ?? wrapped
  })
  return preloadWrapperPromise
}

describe('plugin preload wrapper', () => {
  it('uses distinct cached wrapper files for different preload entries', async () => {
    const {
      clearPreloadCache,
      generateWrappedPreload
    } = await loadPreloadWrapper()

    clearPreloadCache()

    const first = generateWrappedPreload('/mulby/preload/index.js', '/plugin/preload-a.cjs', 'plugin:id')
    const second = generateWrappedPreload('/mulby/preload/index.js', '/plugin/preload-b.cjs', 'plugin:id')

    assert.notEqual(first, second)
    assert.equal(existsSync(first), true)
    assert.equal(existsSync(second), true)
    assert.match(readFileSync(first, 'utf-8'), /preload-a\.cjs/)
    assert.match(readFileSync(second, 'utf-8'), /preload-b\.cjs/)
  })

  it('resolves explicit file-window preload and rejects missing or unsafe entries', async () => {
    const {
      clearPreloadCache,
      getPluginPreloadPathForEntry
    } = await loadPreloadWrapper()

    clearPreloadCache()

    const pluginPath = mkdtempSync(join(tmpdir(), 'mulby-preload-plugin-'))
    try {
      writeFileSync(join(pluginPath, 'main-preload.cjs'), '')
      writeFileSync(join(pluginPath, 'child-preload.js'), '')
      writeFileSync(join(pluginPath, 'not-preload.html'), '')

      const plugin = {
        id: 'plugin-id',
        path: pluginPath,
        manifest: {
          preload: 'main-preload.cjs'
        }
      }

      const explicit = getPluginPreloadPathForEntry('/mulby/preload/index.js', plugin, 'child-preload.js')
      const fallback = getPluginPreloadPathForEntry('/mulby/preload/index.js', plugin)

      assert.notEqual(explicit, fallback)
      assert.match(readFileSync(explicit, 'utf-8'), /child-preload\.js/)
      assert.match(readFileSync(fallback, 'utf-8'), /main-preload\.cjs/)
      assert.throws(
        () => getPluginPreloadPathForEntry('/mulby/preload/index.js', plugin, 'missing.cjs'),
        /does not exist/
      )
      assert.throws(
        () => getPluginPreloadPathForEntry('/mulby/preload/index.js', plugin, '../evil.cjs'),
        /escapes plugin directory/
      )
      assert.throws(
        () => getPluginPreloadPathForEntry('/mulby/preload/index.js', plugin, 'not-preload.html'),
        /Unsupported file extension/
      )
    } finally {
      rmSync(pluginPath, { recursive: true, force: true })
    }
  })
})

process.on('exit', () => {
  if (originalElectronExport !== undefined && require.cache[electronModulePath]) {
    require.cache[electronModulePath]!.exports = originalElectronExport
  }
  if (originalElectronLogExport !== undefined && require.cache[electronLogModulePath]) {
    require.cache[electronLogModulePath]!.exports = originalElectronLogExport
  }
  rmSync(userDataPath, { recursive: true, force: true })
})
