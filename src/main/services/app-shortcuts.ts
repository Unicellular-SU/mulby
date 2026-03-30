import { globalShortcut } from 'electron'
import type {
  AppShortcutAction,
  AppShortcutSettings,
  DoubleTapSettings,
  MouseTriggerSettings,
  ShortcutStatusMap
} from '../../shared/types/settings'
import { detectSystemReservedShortcut } from './system-reserved-shortcuts'
import type { InputHookService, MouseButton, MouseAction } from './input-hook'

// 重试间隔（毫秒）
const RETRY_INTERVAL_MS = 5_000

const ACTION_ORDER: AppShortcutAction[] = [
  'toggleWindow',
  'openSettings'
]

export interface AppShortcutManagerOptions {
  actions: Record<AppShortcutAction, () => void>
  /** 快捷键状态发生变化时的回调（用于后台重试成功后通知渲染进程） */
  onStatusChange?: (status: ShortcutStatusMap) => void
  /** 底层输入钩子服务（统一管理键盘、鼠标、双击修饰键） */
  inputHook?: InputHookService
}

export class AppShortcutManager {
  private registered = new Map<AppShortcutAction, string>()
  private status: ShortcutStatusMap = {
    toggleWindow: { ok: true },
    openSettings: { ok: true }
  }
  private paused = false
  private actions: Record<AppShortcutAction, () => void>
  private onStatusChange?: (status: ShortcutStatusMap) => void
  private inputHook?: InputHookService

  // 重试机制：记录需要重试的 action → accelerator 映射
  private retryTargets = new Map<AppShortcutAction, string>()
  private retryTimer: ReturnType<typeof setInterval> | null = null

  // 当前生效的鼠标触发和双击修饰键设置（用于 pause/resume）
  private currentMouseTrigger: MouseTriggerSettings | null = null
  private currentDoubleTap: DoubleTapSettings | null = null

  constructor(options: AppShortcutManagerOptions) {
    this.actions = options.actions
    this.onStatusChange = options.onStatusChange
    this.inputHook = options.inputHook
  }

  private registerAccelerator(
    accelerator: string,
    action: AppShortcutAction
  ): { ok: true } | { ok: false; reason: 'in-use' | 'invalid' | 'system-reserved' } {
    try {
      const success = globalShortcut.register(accelerator, this.actions[action])
      if (success) return { ok: true }
      return { ok: false, reason: detectSystemReservedShortcut(accelerator) ? 'system-reserved' : 'in-use' }
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }

  /**
   * 尝试通过底层钩子接管快捷键
   * @returns true 表示钩子接管成功
   */
  private activateHook(action: AppShortcutAction, accelerator: string): boolean {
    if (!this.inputHook) return false
    return this.inputHook.register(action, accelerator, this.actions[action])
  }

  /**
   * 停用指定 action 的底层钩子
   */
  private deactivateHook(action: AppShortcutAction): void {
    if (!this.inputHook) return
    this.inputHook.unregister(action)
  }

  apply(shortcuts: AppShortcutSettings): ShortcutStatusMap {
    if (this.paused) {
      return this.status
    }

    // 每次 apply 时清除旧的重试任务和钩子
    this.stopRetry()
    this.inputHook?.unregisterAll()

    const nextStatus: ShortcutStatusMap = {
      toggleWindow: { ok: true },
      openSettings: { ok: true }
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
            this.registered.delete(action)
            if (result.reason === 'in-use') {
              // globalShortcut 失败 → 尝试底层钩子接管
              if (this.activateHook(action, accelerator)) {
                nextStatus[action] = { ok: true, via: 'hook' }
                used.set(key, action)
                this.retryTargets.set(action, accelerator)
              } else {
                nextStatus[action] = { ok: false, reason: result.reason }
                this.retryTargets.set(action, accelerator)
              }
            } else {
              nextStatus[action] = { ok: false, reason: result.reason }
            }
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

      if (result.reason === 'in-use') {
        // globalShortcut 失败 → 尝试底层钩子接管
        if (this.activateHook(action, accelerator)) {
          nextStatus[action] = { ok: true, via: 'hook' }
          used.set(key, action)
          this.retryTargets.set(action, accelerator)
        } else {
          nextStatus[action] = { ok: false, reason: result.reason }
          this.retryTargets.set(action, accelerator)
        }
      } else {
        nextStatus[action] = { ok: false, reason: result.reason }
      }

      if (previous) {
        const rollback = this.registerAccelerator(previous, action)
        if (rollback.ok) {
          this.registered.set(action, previous)
          used.set(previous.toLowerCase(), action)
        }
      }
    }

    this.status = nextStatus

    // 如果有需要重试的快捷键，启动定时器（仍然尝试通过 globalShortcut 抢回）
    if (this.retryTargets.size > 0) {
      this.startRetry()
    }

    return nextStatus
  }

  // ---- 鼠标触发管理（P2-A） ----

  /**
   * 应用鼠标触发设置
   * @param settings 鼠标触发配置
   */
  applyMouseTrigger(settings: MouseTriggerSettings): void {
    if (!this.inputHook) return
    if (this.paused) {
      // 暂停时仅保存配置，resume 时应用
      this.currentMouseTrigger = settings
      return
    }

    // 先移除旧绑定
    this.inputHook.unregisterMouse('toggleWindow-mouse')

    if (settings.enabled) {
      this.inputHook.registerMouse(
        'toggleWindow-mouse',
        settings.button as MouseButton,
        settings.action as MouseAction,
        () => this.actions.toggleWindow(),
        settings.longPressMs
      )
    }

    this.currentMouseTrigger = settings
  }

  // ---- 双击修饰键管理（P2-B） ----

  /**
   * 应用双击修饰键设置
   * @param settings 双击修饰键配置
   */
  applyDoubleTap(settings: DoubleTapSettings): void {
    if (!this.inputHook) return
    if (this.paused) {
      // 暂停时仅保存配置，resume 时应用
      this.currentDoubleTap = settings
      return
    }

    // 先清除所有修饰键绑定
    for (const mod of ['Command', 'Ctrl', 'Alt', 'Shift']) {
      this.inputHook.unregisterDoubleTap(mod)
    }

    if (settings.enabled) {
      this.inputHook.registerDoubleTap(
        settings.modifier,
        () => this.actions.toggleWindow()
      )
    }

    this.currentDoubleTap = settings
  }

  getStatus(): ShortcutStatusMap {
    return this.status
  }

  isPaused(): boolean {
    return this.paused
  }

  pause() {
    if (this.paused) return
    this.stopRetry()
    this.inputHook?.unregisterEverything()
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
    const result = this.apply(shortcuts)

    // 恢复鼠标触发和双击修饰键
    if (this.currentMouseTrigger) {
      this.applyMouseTrigger(this.currentMouseTrigger)
    }
    if (this.currentDoubleTap) {
      this.applyDoubleTap(this.currentDoubleTap)
    }

    return result
  }

  unregisterAll() {
    this.stopRetry()
    this.inputHook?.unregisterEverything()
    for (const accel of this.registered.values()) {
      globalShortcut.unregister(accel)
    }
    this.registered.clear()
  }

  /** 启动后台重试定时器 */
  private startRetry() {
    if (this.retryTimer) return
    this.retryTimer = setInterval(() => {
      this.retryOnce()
    }, RETRY_INTERVAL_MS)
  }

  /** 停止后台重试定时器 */
  private stopRetry() {
    this.retryTargets.clear()
    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = null
    }
  }

  /** 执行一次重试尝试（尝试通过 globalShortcut 抢回，成功后关闭钩子） */
  private retryOnce() {
    if (this.paused || this.retryTargets.size === 0) {
      this.stopRetry()
      return
    }

    let changed = false

    for (const [action, accelerator] of this.retryTargets) {
      const result = this.registerAccelerator(accelerator, action)
      if (result.ok) {
        // globalShortcut 抢回成功 → 关闭对应的底层钩子
        this.deactivateHook(action)
        this.registered.set(action, accelerator)
        this.status = { ...this.status, [action]: { ok: true } }
        this.retryTargets.delete(action)
        changed = true
      }
    }

    // 所有重试目标都已成功，停止定时器
    if (this.retryTargets.size === 0) {
      this.stopRetry()
    }

    // 如果有状态变化，通知外部
    if (changed && this.onStatusChange) {
      this.onStatusChange(this.status)
    }
  }
}
