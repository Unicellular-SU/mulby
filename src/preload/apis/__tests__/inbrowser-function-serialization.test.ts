import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const electronModulePath = require.resolve('electron')
const originalElectronExport = require.cache[electronModulePath]?.exports

type InBrowserModule = typeof import('../inbrowser')
let executeInMainWorldMock: ((script: { func: (...args: unknown[]) => unknown; args?: unknown[] }) => unknown) | undefined
let inBrowserModulePromise: Promise<InBrowserModule> | null = null

function installElectronMock() {
  ;(require.cache as Record<string, NodeJS.Module | undefined>)[electronModulePath] = {
    id: electronModulePath,
    filename: electronModulePath,
    loaded: true,
    exports: {
      ipcRenderer: {
        invoke: async () => []
      },
      contextBridge: {
        executeInMainWorld: (script: { func: (...args: unknown[]) => unknown; args?: unknown[] }) =>
          executeInMainWorldMock?.(script)
      }
    },
    children: [],
    paths: [],
    parent: null,
    path: '',
    require,
    isPreloading: false
  } as unknown as NodeJS.Module
}

async function loadInBrowserModule(): Promise<InBrowserModule> {
  inBrowserModulePromise ??= import('../inbrowser').then((module) => {
    const wrapped = module as unknown as { default?: InBrowserModule } & InBrowserModule
    return wrapped.default ?? wrapped
  })
  return inBrowserModulePromise
}

installElectronMock()

describe('InBrowser preload function serialization', () => {
  it('uses contextBridge.executeInMainWorld to serialize proxied functions from the main world', async () => {
    const { serializeInBrowserFunction } = await loadInBrowserModule()
    const mainWorldFunctionSource = '() => document.title'
    const proxiedFunction = new Proxy(() => undefined, {}) as (...args: unknown[]) => unknown
    let didExecuteInMainWorld = false

    executeInMainWorldMock = (script) => {
      didExecuteInMainWorld = true
      assert.equal(script.args?.[0], proxiedFunction)
      return mainWorldFunctionSource
    }

    const source = serializeInBrowserFunction(proxiedFunction, 'evaluate')

    assert.equal(source, mainWorldFunctionSource)
    assert.equal(didExecuteInMainWorld, true)
  })

  it('throws a focused error when a function source cannot be recovered across contextBridge', async () => {
    const { serializeInBrowserFunction } = await loadInBrowserModule()
    const proxiedFunction = new Proxy(() => undefined, {}) as (...args: unknown[]) => unknown
    executeInMainWorldMock = undefined

    assert.throws(
      () => serializeInBrowserFunction(proxiedFunction, 'wait'),
      /Cannot serialize function passed across ContextBridge/
    )
  })
})

process.on('exit', () => {
  if (originalElectronExport !== undefined && require.cache[electronModulePath]) {
    require.cache[electronModulePath]!.exports = originalElectronExport
  }
})
