import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import {
  applyWindowContentClipToWebContents,
  applyWindowResizeHandlesToWebContents,
  applyWindowsFramelessSurfaceToWebContents
} from '../window-surface'

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

  it('can inject resize handles without reserving frameless surface insets', async () => {
    const styles: string[] = []
    const webContents = {
      isDestroyed: () => false,
      insertCSS: async (style: string) => {
        styles.push(style)
      },
      executeJavaScript: async () => undefined
    }

    await applyWindowResizeHandlesToWebContents(webContents as never, {
      resizeMode: 'bottom',
      useSurfaceInsets: false
    })

    assert.equal(styles.length, 1)
    assert.match(styles[0], /#mulby-window-resize-layer\s*\{[\s\S]*inset: 0px 0px 0px 0px !important;/)
  })

  it('defaults standalone resize handles to content-edge insets', async () => {
    const styles: string[] = []
    const webContents = {
      isDestroyed: () => false,
      insertCSS: async (style: string) => {
        styles.push(style)
      },
      executeJavaScript: async () => undefined
    }

    await applyWindowResizeHandlesToWebContents(webContents as never, {
      resizeMode: 'bottom'
    })

    assert.equal(styles.length, 1)
    assert.match(styles[0], /#mulby-window-resize-layer\s*\{[\s\S]*inset: 0px 0px 0px 0px !important;/)
  })

  it('does not apply Windows resize insets on non-Windows platforms', async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    const styles: string[] = []
    const webContents = {
      isDestroyed: () => false,
      insertCSS: async (style: string) => {
        styles.push(style)
      },
      executeJavaScript: async () => undefined
    }

    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      await applyWindowResizeHandlesToWebContents(webContents as never, {
        resizeMode: 'bottom',
        useSurfaceInsets: true
      })
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor)
      }
    }

    assert.equal(styles.length, 1)
    assert.match(styles[0], /#mulby-window-resize-layer\s*\{[\s\S]*inset: 0px 0px 0px 0px !important;/)
  })

  it('keeps Windows frameless surface resize handles on surface insets', async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    const styles: string[] = []
    const webContents = {
      isDestroyed: () => false,
      insertCSS: async (style: string) => {
        styles.push(style)
      },
      executeJavaScript: async () => undefined
    }

    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      await applyWindowsFramelessSurfaceToWebContents(webContents as never, { resizeMode: 'bottom' })
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor)
      }
    }

    assert.equal(styles.length, 2)
    assert.match(styles[1], /#mulby-window-resize-layer\s*\{[\s\S]*inset: 18px 18px 18px 18px !important;/)
  })

  it('still generates a content host for the full frameless surface helper', async () => {
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
    assert.match(scripts[0], /const hostId = 'mulby-window-content-host'/)
  })

  it('can clip reused plugin content to rounded corners without creating a content host', async () => {
    const styles: string[] = []
    const scripts: string[] = []
    const webContents = {
      isDestroyed: () => false,
      insertCSS: async (style: string) => {
        styles.push(style)
      },
      executeJavaScript: async (script: string) => {
        scripts.push(script)
        return undefined
      }
    }

    await applyWindowContentClipToWebContents(webContents as never)

    assert.equal(styles.length, 1)
    assert.equal(scripts.length, 0)
    assert.match(styles[0], /border-radius: 12px !important;/)
    assert.match(styles[0], /overflow: hidden !important;/)
    assert.doesNotMatch(styles[0], /html,\s*body\s*\{[\s\S]*background: transparent !important;/)
    assert.doesNotMatch(styles[0], /body\s*>\s*:not\(script\)[\s\S]*background/)
    assert.doesNotMatch(styles[0], /mulby-window-content-host/)
  })
})
