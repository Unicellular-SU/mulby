import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getPluginRendererCapabilities,
  getPluginRendererWebPreferences,
  installPluginWebviewSecurity
} from '../plugin-web-preferences'
import type { WebContents, WebPreferences } from 'electron'
import type { Plugin } from '../../../shared/types/plugin'

function createPlugin(webview?: boolean): Plugin {
  return {
    id: 'test.plugin',
    path: '/tmp/test-plugin',
    enabled: true,
    manifest: {
      name: 'test-plugin',
      version: '1.0.0',
      displayName: 'Test Plugin',
      description: 'Test plugin',
      main: 'main.js',
      permissions: webview === undefined ? undefined : { webview },
      features: []
    }
  }
}

function createFakeWebContents() {
  let listener: ((event: { preventDefault: () => void }, webPreferences: WebPreferences) => void) | null = null

  return {
    webContents: {
      on: (eventName: string, callback: typeof listener) => {
        if (eventName === 'will-attach-webview') {
          listener = callback
        }
      }
    },
    emitAttach: (webPreferences: WebPreferences) => {
      let prevented = false
      listener?.({ preventDefault: () => { prevented = true } }, webPreferences)
      return prevented
    }
  }
}

describe('plugin web preferences', () => {
  it('enables webviewTag only when the plugin manifest requests webview permission', () => {
    const pluginWithoutWebview = createPlugin()
    const pluginWithWebview = createPlugin(true)

    assert.deepEqual(getPluginRendererCapabilities(pluginWithoutWebview), { webview: false })
    assert.deepEqual(getPluginRendererWebPreferences(pluginWithoutWebview), {})
    assert.deepEqual(getPluginRendererCapabilities(pluginWithWebview), { webview: true })
    assert.deepEqual(getPluginRendererWebPreferences(pluginWithWebview), { webviewTag: true })
  })

  it('prevents undeclared webviews and strips guest preload/node settings for allowed webviews', () => {
    const denied = createFakeWebContents()
    installPluginWebviewSecurity(denied.webContents as unknown as WebContents, createPlugin(false))
    assert.equal(denied.emitAttach({ preload: '/tmp/unsafe.cjs', nodeIntegration: true }), true)

    const allowed = createFakeWebContents()
    installPluginWebviewSecurity(allowed.webContents as unknown as WebContents, createPlugin(true))
    const webPreferences: WebPreferences = {
      preload: '/tmp/unsafe.cjs',
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      sandbox: false,
      webviewTag: true
    }

    assert.equal(allowed.emitAttach(webPreferences), false)
    assert.equal(webPreferences.preload, undefined)
    assert.equal(webPreferences.nodeIntegration, false)
    assert.equal(webPreferences.nodeIntegrationInSubFrames, false)
    assert.equal(webPreferences.nodeIntegrationInWorker, false)
    assert.equal(webPreferences.contextIsolation, true)
    assert.equal(webPreferences.sandbox, true)
    assert.equal(webPreferences.webviewTag, false)
  })
})
