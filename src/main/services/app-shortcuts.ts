import type {
  AppShortcutAction,
  AppShortcutSettings,
  DoubleTapSettings,
  MouseTriggerSettings,
  ShortcutStatusMap
} from '../../shared/types/settings'
import type { InputHookService, MouseButton, MouseAction } from './input-hook'

const ACTION_ORDER: AppShortcutAction[] = [
  'toggleWindow',
  'openSettings'
]

const APP_SHORTCUT_HOOK_PREFIX = 'app-shortcut:'

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
  private inputHook?: InputHookService

  // 当前生效的鼠标触发和双击修饰键设置（用于 pause/resume）
  private currentMouseTrigger: MouseTriggerSettings | null = null
  private currentDoubleTap: DoubleTapSettings | null = null

  constructor(options: AppShortcutManagerOptions) {
    this.actions = options.actions
    this.inputHook = options.inputHook
  }

  private getHookId(action: AppShortcutAction): string {
    return `${APP_SHORTCUT_HOOK_PREFIX}${action}`
  }

  private registerHook(action: AppShortcutAction, accelerator: string): boolean {
    if (!this.inputHook) return false
    return this.inputHook.register(this.getHookId(action), accelerator, this.actions[action], { consume: true })
  }

  private unregisterKeyboardHooks(): void {
    this.inputHook?.unregisterByPrefix(APP_SHORTCUT_HOOK_PREFIX)
    this.registered.clear()
  }

  private unregisterMouseTrigger(): void {
    this.inputHook?.unregisterMouse('toggleWindow-mouse')
  }

  private unregisterDoubleTap(): void {
    if (!this.inputHook) return
    for (const modifier of ['Command', 'Ctrl', 'Alt', 'Shift']) {
      this.inputHook.unregisterDoubleTap(modifier)
    }
  }

  apply(shortcuts: AppShortcutSettings): ShortcutStatusMap {
    if (this.paused) {
      return this.status
    }

    this.unregisterKeyboardHooks()

    const nextStatus: ShortcutStatusMap = {
      toggleWindow: { ok: true },
      openSettings: { ok: true }
    }
    const used = new Map<string, AppShortcutAction>()

    for (const action of ACTION_ORDER) {
      const accelerator = (shortcuts[action] || '').trim()
      if (!accelerator) {
        continue
      }

      const key = accelerator.toLowerCase()

      if (used.has(key)) {
        nextStatus[action] = { ok: false, reason: 'duplicate' }
        continue
      }

      if (this.registerHook(action, accelerator)) {
        this.registered.set(action, accelerator)
        used.set(key, action)
        nextStatus[action] = { ok: true, via: 'hook' }
        continue
      }

      nextStatus[action] = { ok: false, reason: 'invalid' }
    }

    this.status = nextStatus
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
    this.unregisterKeyboardHooks()
    this.unregisterMouseTrigger()
    this.unregisterDoubleTap()
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
    this.unregisterKeyboardHooks()
    this.unregisterMouseTrigger()
    this.unregisterDoubleTap()
  }
}
