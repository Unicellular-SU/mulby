import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { installPluginViewFocusBridge } from '../plugin-view-focus-bridge'

type InstallArgs = Parameters<typeof installPluginViewFocusBridge>

type Handler = () => void

class FakeEmitter {
  private handlers = new Map<string, Handler[]>()

  on(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  emit(event: string): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler()
    }
  }
}

describe('plugin view focus bridge', () => {
  it('focuses the plugin view when a detached shell window receives focus', () => {
    const win = new FakeEmitter() as FakeEmitter & {
      id: number
      isDestroyed: () => boolean
      isFocused: () => boolean
      focus: () => void
    }
    const webContents = new FakeEmitter() as FakeEmitter & {
      isDestroyed: () => boolean
      isFocused: () => boolean
      focus: () => void
    }
    let pluginViewFocusCount = 0

    Object.assign(win, {
      id: 10,
      isDestroyed: () => false,
      isFocused: () => true,
      focus: () => {}
    })
    Object.assign(webContents, {
      isDestroyed: () => false,
      isFocused: () => false,
      focus: () => {
        pluginViewFocusCount += 1
      }
    })

    installPluginViewFocusBridge(win as unknown as InstallArgs[0], { webContents } as unknown as InstallArgs[1])
    win.emit('focus')

    assert.equal(pluginViewFocusCount, 1)
  })

  it('focuses the host window before plugin input when the shell is not focused', () => {
    const win = new FakeEmitter() as FakeEmitter & {
      id: number
      isDestroyed: () => boolean
      isFocused: () => boolean
      focus: () => void
    }
    const webContents = new FakeEmitter() as FakeEmitter & {
      isDestroyed: () => boolean
      isFocused: () => boolean
      focus: () => void
    }
    let hostFocusCount = 0

    Object.assign(win, {
      id: 11,
      isDestroyed: () => false,
      isFocused: () => false,
      focus: () => {
        hostFocusCount += 1
      }
    })
    Object.assign(webContents, {
      isDestroyed: () => false,
      isFocused: () => true,
      focus: () => {}
    })

    installPluginViewFocusBridge(win as unknown as InstallArgs[0], { webContents } as unknown as InstallArgs[1])
    webContents.emit('before-input-event')

    assert.equal(hostFocusCount, 1)
  })
})
