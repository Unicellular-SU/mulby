import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const electronModulePath = require.resolve('electron')
const electronLogModulePath = require.resolve('electron-log')
const originalElectronExport = require.cache[electronModulePath]?.exports
const originalElectronLogExport = require.cache[electronLogModulePath]?.exports

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

function restoreModuleMock(modulePath: string, originalExport: unknown): void {
  const cache = require.cache as Record<string, NodeJS.Module | undefined>
  if (originalExport === undefined) {
    delete cache[modulePath]
    return
  }

  if (cache[modulePath]) {
    cache[modulePath]!.exports = originalExport
  }
}

installModuleMock(electronModulePath, {
  app: {
    hide: () => {},
    show: () => {}
  },
  BrowserWindow: {
    getAllWindows: () => [],
    fromId: () => null
  },
  clipboard: {
    writeText: () => {},
    writeImage: () => {},
    writeBuffer: () => {}
  },
  nativeImage: {
    createFromBuffer: () => ({ isEmpty: () => false }),
    createFromDataURL: () => ({ isEmpty: () => false }),
    createFromPath: () => ({ isEmpty: () => false })
  }
})
installModuleMock(electronLogModulePath, {
  error: () => {},
  warn: () => {},
  info: () => {}
})

type InputModule = typeof import('../input')
let inputPromise: Promise<InputModule> | null = null

async function loadInput(): Promise<InputModule> {
  inputPromise ??= import('../input').then((module) => {
    const wrapped = module as unknown as { default?: InputModule } & InputModule
    return wrapped.default ?? wrapped
  })
  return inputPromise
}

describe('plugin input validation', () => {
  it('normalizes finite coordinates and rejects script-shaped values', async () => {
    const { normalizeInputCoordinate } = await loadInput()

    assert.equal(normalizeInputCoordinate(12.4, 'x'), 12)
    assert.equal(normalizeInputCoordinate('18.6', 'y'), 19)
    assert.throws(() => normalizeInputCoordinate('1); $.evil(); //', 'x'), /finite number/)
    assert.throws(() => normalizeInputCoordinate(Number.POSITIVE_INFINITY, 'x'), /finite number/)
    assert.throws(() => normalizeInputCoordinate({ value: 10 }, 'x'), /finite number/)
  })

  it('whitelists keyboard keys used by script-backed simulators', async () => {
    const { normalizeInputKeyboardKey } = await loadInput()

    assert.equal(normalizeInputKeyboardKey('A'), 'a')
    assert.equal(normalizeInputKeyboardKey(' Tab '), 'tab')
    assert.equal(normalizeInputKeyboardKey('F5'), 'f5')
    assert.throws(() => normalizeInputKeyboardKey('" using command down --'), /Unsupported input key/)
    assert.throws(() => normalizeInputKeyboardKey('enter; Start-Process calc'), /Unsupported input key/)
  })

  it('whitelists keyboard modifiers used by script-backed simulators', async () => {
    const { normalizeInputKeyboardModifiers } = await loadInput()

    assert.deepEqual(normalizeInputKeyboardModifiers(['CTRL', ' shift ']), ['ctrl', 'shift'])
    assert.throws(() => normalizeInputKeyboardModifiers(['ctrl', 'bad;command']), /Unsupported input modifier/)
    assert.throws(() => normalizeInputKeyboardModifiers(['ctrl', 12]), /modifier must be a string/)
  })
})

after(() => {
  restoreModuleMock(electronModulePath, originalElectronExport)
  restoreModuleMock(electronLogModulePath, originalElectronLogExport)
})
