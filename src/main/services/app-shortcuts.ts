import { globalShortcut } from 'electron'
import type { AppShortcutAction, AppShortcutSettings, ShortcutStatusMap } from '../../shared/types/settings'
import { detectSystemReservedShortcut } from './system-reserved-shortcuts'

const ACTION_ORDER: AppShortcutAction[] = [
  'toggleWindow',
  'openSettings',
  'openAiSettings',
  'openPluginStore',
  'openPluginManager',
  'openBackgroundPlugins',
  'openTaskScheduler',
  'openLogViewer'
]

export class AppShortcutManager {
  private registered = new Map<AppShortcutAction, string>()
  private status: ShortcutStatusMap = {
    toggleWindow: { ok: true },
    openSettings: { ok: true },
    openAiSettings: { ok: true },
    openPluginStore: { ok: true },
    openPluginManager: { ok: true },
    openBackgroundPlugins: { ok: true },
    openTaskScheduler: { ok: true },
    openLogViewer: { ok: true }
  }
  private paused = false
  private actions: Record<AppShortcutAction, () => void>

  constructor(actions: Record<AppShortcutAction, () => void>) {
    this.actions = actions
  }

  private registerAccelerator(
    accelerator: string,
    action: AppShortcutAction
  ): { ok: true } | { ok: false; reason: 'in-use' | 'invalid' | 'system-reserved' } {
    const reservedReason = detectSystemReservedShortcut(accelerator)
    const allowReservedForToggle = reservedReason === 'win-alt-space' && action === 'toggleWindow'
    if (reservedReason && !allowReservedForToggle) {
      return { ok: false, reason: 'system-reserved' }
    }
    try {
      const success = globalShortcut.register(accelerator, this.actions[action])
      if (success) return { ok: true }
      return { ok: false, reason: 'in-use' }
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }

  apply(shortcuts: AppShortcutSettings): ShortcutStatusMap {
    if (this.paused) {
      return this.status
    }
    const nextStatus: ShortcutStatusMap = {
      toggleWindow: { ok: true },
      openSettings: { ok: true },
      openAiSettings: { ok: true },
      openPluginStore: { ok: true },
      openPluginManager: { ok: true },
      openBackgroundPlugins: { ok: true },
      openTaskScheduler: { ok: true },
      openLogViewer: { ok: true }
    }
    const used = new Map<string, AppShortcutAction>()

    for (const action of ACTION_ORDER) {
      const accelerator = (shortcuts[action] || '').trim()
      const previous = this.registered.get(action)

      if (!accelerator) {
        if (previous) {
          globalShortcut.unregister(previous)
          this.registered.delete(action)
        }
        continue
      }

      const key = accelerator.toLowerCase()

      if (used.has(key)) {
        nextStatus[action] = { ok: false, reason: 'duplicate' }
        continue
      }

      if (previous && previous.toLowerCase() === key) {
        if (!globalShortcut.isRegistered(previous)) {
          const result = this.registerAccelerator(previous, action)
          if (!result.ok) {
            nextStatus[action] = { ok: false, reason: result.reason }
            this.registered.delete(action)
            continue
          }
        }
        this.registered.set(action, accelerator)
        used.set(key, action)
        continue
      }

      if (previous) {
        globalShortcut.unregister(previous)
        this.registered.delete(action)
      }

      const result = this.registerAccelerator(accelerator, action)
      if (result.ok) {
        this.registered.set(action, accelerator)
        used.set(key, action)
        nextStatus[action] = { ok: true }
        continue
      }

      nextStatus[action] = { ok: false, reason: result.reason }

      if (previous) {
        const rollback = this.registerAccelerator(previous, action)
        if (rollback.ok) {
          this.registered.set(action, previous)
          used.set(previous.toLowerCase(), action)
        }
      }
    }

    this.status = nextStatus
    return nextStatus
  }

  getStatus(): ShortcutStatusMap {
    return this.status
  }

  isPaused(): boolean {
    return this.paused
  }

  pause() {
    if (this.paused) return
    for (const accel of this.registered.values()) {
      globalShortcut.unregister(accel)
    }
    this.paused = true
  }

  resume(shortcuts: AppShortcutSettings): ShortcutStatusMap {
    if (!this.paused) {
      return this.status
    }
    this.paused = false
    return this.apply(shortcuts)
  }

  unregisterAll() {
    for (const accel of this.registered.values()) {
      globalShortcut.unregister(accel)
    }
    this.registered.clear()
  }
}
