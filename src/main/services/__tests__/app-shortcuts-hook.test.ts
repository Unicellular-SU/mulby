import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AppShortcutManager } from '../app-shortcuts'
import type { AppShortcutSettings } from '../../../shared/types/settings'

class MockInputHook {
  readonly registerCalls: Array<{ id: string; accelerator: string; consume?: boolean }> = []
  readonly unregisterByPrefixCalls: string[] = []
  private readonly handlers = new Map<string, () => void>()

  register(id: string, accelerator: string, callback: () => void, options?: { consume?: boolean }): boolean {
    this.registerCalls.push({ id, accelerator, consume: options?.consume })
    this.handlers.set(id, callback)
    return true
  }

  unregisterByPrefix(prefix: string): void {
    this.unregisterByPrefixCalls.push(prefix)
    for (const id of Array.from(this.handlers.keys())) {
      if (id.startsWith(prefix)) this.handlers.delete(id)
    }
  }
}

function createSettings(partial: Partial<AppShortcutSettings> = {}): AppShortcutSettings {
  return {
    toggleWindow: 'Alt+Space',
    openSettings: 'CommandOrControl+,',
    ...partial
  }
}

describe('AppShortcutManager hook-first keyboard shortcuts', () => {
  it('registers app shortcuts through InputHookService even for Windows-reserved accelerators', () => {
    const inputHook = new MockInputHook()
    const manager = new AppShortcutManager({
      actions: {
        toggleWindow: () => {},
        openSettings: () => {}
      },
      inputHook: inputHook as never
    })

    const status = manager.apply(createSettings({ toggleWindow: 'Alt+Space', openSettings: '' }))

    assert.deepEqual(status.toggleWindow, { ok: true, via: 'hook' })
    assert.deepEqual(inputHook.registerCalls, [
      { id: 'app-shortcut:toggleWindow', accelerator: 'Alt+Space', consume: true }
    ])
  })

  it('detects duplicate app shortcuts before registering hooks', () => {
    const inputHook = new MockInputHook()
    const manager = new AppShortcutManager({
      actions: {
        toggleWindow: () => {},
        openSettings: () => {}
      },
      inputHook: inputHook as never
    })

    const status = manager.apply(createSettings({ toggleWindow: 'F1', openSettings: 'F1' }))

    assert.deepEqual(status.toggleWindow, { ok: true, via: 'hook' })
    assert.deepEqual(status.openSettings, { ok: false, reason: 'duplicate' })
    assert.deepEqual(inputHook.registerCalls, [
      { id: 'app-shortcut:toggleWindow', accelerator: 'F1', consume: true }
    ])
  })

  it('refreshes only app shortcut hooks without clearing plugin-owned hooks', () => {
    const inputHook = new MockInputHook()
    const manager = new AppShortcutManager({
      actions: {
        toggleWindow: () => {},
        openSettings: () => {}
      },
      inputHook: inputHook as never
    })

    manager.apply(createSettings({ toggleWindow: 'F1', openSettings: '' }))
    manager.apply(createSettings({ toggleWindow: 'F2', openSettings: '' }))

    assert.deepEqual(inputHook.unregisterByPrefixCalls, ['app-shortcut:', 'app-shortcut:'])
  })
})
