import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AppShortcutManager } from '../app-shortcuts'
import type { AppShortcutSettings } from '../../../shared/types/settings'

class MockGlobalShortcut {
  readonly registerCalls: string[] = []
  readonly unregisterCalls: string[] = []
  readonly failOnRegister = new Set<string>()
  private readonly callbacks = new Map<string, () => void>()

  register(accelerator: string, callback: () => void): boolean {
    this.registerCalls.push(accelerator)
    if (this.failOnRegister.has(accelerator)) return false
    this.callbacks.set(accelerator, callback)
    return true
  }

  unregister(accelerator: string): void {
    this.unregisterCalls.push(accelerator)
    this.callbacks.delete(accelerator)
  }

  isRegistered(accelerator: string): boolean {
    return this.callbacks.has(accelerator)
  }
}

class MockInputHook {
  readonly registerCalls: Array<{ id: string; accelerator: string; consume?: boolean }> = []

  register(id: string, accelerator: string, _callback: () => void, options?: { consume?: boolean }): boolean {
    this.registerCalls.push({ id, accelerator, consume: options?.consume })
    return true
  }

  unregister(_id: string): void {}
  unregisterByPrefix(_prefix: string): void {}
  unregisterMouse(_id: string): void {}
  unregisterDoubleTap(_modifier: string): void {}
}

function settings(partial: Partial<AppShortcutSettings> = {}): AppShortcutSettings {
  return { toggleWindow: 'Alt+Space', openSettings: '', ...partial }
}

describe('AppShortcutManager globalShortcut-first behavior', () => {
  it('macOS without Input Monitoring: registers via globalShortcut, never starts the hook', () => {
    const globalShortcut = new MockGlobalShortcut()
    const inputHook = new MockInputHook()
    const manager = new AppShortcutManager({
      actions: { toggleWindow: () => {}, openSettings: () => {} },
      inputHook: inputHook as never,
      globalShortcut,
      isInputMonitoringGranted: () => false,
      platform: 'darwin'
    })

    const status = manager.apply(settings({ toggleWindow: 'Alt+Space' }))

    // globalShortcut 无需权限即可生效 → ok 且不显示「底层接管中」(无 via)
    assert.deepEqual(status.toggleWindow, { ok: true })
    assert.deepEqual(globalShortcut.registerCalls, ['Alt+Space'])
    assert.deepEqual(inputHook.registerCalls, [])
  })

  it('macOS without Input Monitoring: a system-occupied combo surfaces a permission status (not a fake 底层接管中)', () => {
    const globalShortcut = new MockGlobalShortcut()
    globalShortcut.failOnRegister.add('Command+Space')
    const manager = new AppShortcutManager({
      actions: { toggleWindow: () => {}, openSettings: () => {} },
      inputHook: new MockInputHook() as never,
      globalShortcut,
      isInputMonitoringGranted: () => false,
      platform: 'darwin'
    })

    const status = manager.apply(settings({ toggleWindow: 'Command+Space' }))

    assert.deepEqual(status.toggleWindow, { ok: false, reason: 'permission' })
    assert.equal(manager.isHookNeeded(), true)
  })

  it('macOS with Input Monitoring granted: prefers the hook so reserved combos can be intercepted', () => {
    const globalShortcut = new MockGlobalShortcut()
    const inputHook = new MockInputHook()
    const manager = new AppShortcutManager({
      actions: { toggleWindow: () => {}, openSettings: () => {} },
      inputHook: inputHook as never,
      globalShortcut,
      isInputMonitoringGranted: () => true,
      platform: 'darwin'
    })

    const status = manager.apply(settings({ toggleWindow: 'Command+Space' }))

    assert.deepEqual(status.toggleWindow, { ok: true, via: 'hook' })
    assert.deepEqual(globalShortcut.registerCalls, [])
    assert.deepEqual(inputHook.registerCalls, [
      { id: 'app-shortcut:toggleWindow', accelerator: 'Command+Space', consume: true }
    ])
  })

  it('Windows: globalShortcut is primary, hook is the fallback when occupied', () => {
    const globalShortcut = new MockGlobalShortcut()
    globalShortcut.failOnRegister.add('Alt+Space')
    const inputHook = new MockInputHook()
    const manager = new AppShortcutManager({
      actions: { toggleWindow: () => {}, openSettings: () => {} },
      inputHook: inputHook as never,
      globalShortcut,
      platform: 'win32'
    })

    const status = manager.apply(settings({ toggleWindow: 'Alt+Space' }))

    assert.deepEqual(status.toggleWindow, { ok: true, via: 'hook' })
    assert.deepEqual(inputHook.registerCalls, [
      { id: 'app-shortcut:toggleWindow', accelerator: 'Alt+Space', consume: true }
    ])
  })
})
