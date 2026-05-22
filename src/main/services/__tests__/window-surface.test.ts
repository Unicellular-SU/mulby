import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { applyWindowsFramelessSurfaceToWebContents } from '../window-surface'

describe('Windows frameless surface scripts', () => {
  it('separates injected surface and resize IIFEs so they execute independently', async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    const scripts: string[] = []
    const webContents = {
      isDestroyed: () => false,
      insertCSS: async () => undefined,
      executeJavaScript: async (script: string) => {
        scripts.push(script)
        return undefined
      }
    }

    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      await applyWindowsFramelessSurfaceToWebContents(webContents as never, { resizeMode: 'bottom' })
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor)
      }
    }

    assert.equal(scripts.length, 1)
    assert.doesNotThrow(() => {
      vm.runInNewContext(scripts[0], { document: { body: null } })
    })
  })
})
