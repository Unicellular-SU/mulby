import { globalShortcut } from 'electron'
import type { AppShortcutAction, AppShortcutSettings, ShortcutStatusMap } from '../../shared/types/settings'

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

      if (used.has(accelerator)) {
        nextStatus[action] = { ok: false, reason: 'duplicate' }
        continue
      }

      if (previous === accelerator) {
        if (!globalShortcut.isRegistered(accelerator)) {
          try {
            globalShortcut.register(accelerator, this.actions[action])
          } catch {
            nextStatus[action] = { ok: false, reason: 'invalid' }
            continue
          }
        }
        used.set(accelerator, action)
        continue
      }

      if (globalShortcut.isRegistered(accelerator)) {
        nextStatus[action] = { ok: false, reason: 'in-use' }
        continue
      }

      try {
        const success = globalShortcut.register(accelerator, this.actions[action])
        if (success) {
          if (previous) {
            globalShortcut.unregister(previous)
            this.registered.delete(action)
          }
          this.registered.set(action, accelerator)
          used.set(accelerator, action)
          nextStatus[action] = { ok: true }
        } else {
          nextStatus[action] = { ok: false, reason: 'in-use' }
        }
      } catch {
        nextStatus[action] = { ok: false, reason: 'invalid' }
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
