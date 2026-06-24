import type {
  AppShortcutAction,
  AppShortcutSettings,
  DoubleTapSettings,
  MouseTriggerSettings,
  ShortcutStatus,
  ShortcutStatusMap
} from '../../shared/types/settings'
import type { InputHookService, MouseButton, MouseAction } from './input-hook'
import { detectSystemReservedShortcut } from './system-reserved-shortcuts'

const ACTION_ORDER: AppShortcutAction[] = [
  'toggleWindow',
  'openSettings'
]

const APP_SHORTCUT_HOOK_PREFIX = 'app-shortcut:'

/**
 * Electron globalShortcut 的最小依赖接口（便于单元测试注入 mock）。
 * 生产环境注入 electron 的 globalShortcut。
 */
export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  isRegistered(accelerator: string): boolean
}

type RegisteredVia = 'global' | 'hook'

export interface AppShortcutManagerOptions {
  actions: Record<AppShortcutAction, () => void>
  /** 快捷键状态发生变化时的回调（用于后台重试成功后通知渲染进程） */
  onStatusChange?: (status: ShortcutStatusMap) => void
  /** 底层输入钩子服务（统一管理键盘、鼠标、双击修饰键） */
  inputHook?: InputHookService
  /** 系统级 globalShortcut（Carbon RegisterEventHotKey，无需任何权限）。注入后作为主/兜底注册路径。 */
  globalShortcut?: GlobalShortcutLike
  /** macOS：底层钩子是否真正可用（已授予「输入监控」权限）。用于诚实地反馈状态，避免谎报「底层接管中」。 */
  isInputMonitoringGranted?: () => boolean
  /** 平台覆盖（仅用于测试）；默认 process.platform。 */
  platform?: NodeJS.Platform
}

export class AppShortcutManager {
  private registered = new Map<AppShortcutAction, { accelerator: string; via: RegisteredVia }>()
  private status: ShortcutStatusMap = {
    toggleWindow: { ok: true },
    openSettings: { ok: true }
  }
  private paused = false
  private actions: Record<AppShortcutAction, () => void>
  private inputHook?: InputHookService
  private globalShortcut?: GlobalShortcutLike
  private isInputMonitoringGranted?: () => boolean
  private platform: NodeJS.Platform

  // 当前生效的鼠标触发和双击修饰键设置（用于 pause/resume）
  private currentMouseTrigger: MouseTriggerSettings | null = null
  private currentDoubleTap: DoubleTapSettings | null = null

  constructor(options: AppShortcutManagerOptions) {
    this.actions = options.actions
    this.inputHook = options.inputHook
    this.globalShortcut = options.globalShortcut
    this.isInputMonitoringGranted = options.isInputMonitoringGranted
    this.platform = options.platform ?? process.platform
  }

  private getHookId(action: AppShortcutAction): string {
    return `${APP_SHORTCUT_HOOK_PREFIX}${action}`
  }

  private registerHook(action: AppShortcutAction, accelerator: string): boolean {
    if (!this.inputHook) return false
    return this.inputHook.register(this.getHookId(action), accelerator, this.actions[action], { consume: true })
  }

  /** macOS 下底层钩子是否可用（注入了检测函数则以其为准；未注入时默认可用，兼容单测） */
  private hookUsableOnDarwin(): boolean {
    return this.isInputMonitoringGranted ? this.isInputMonitoringGranted() : true
  }

  private unregisterKeyboard(): void {
    if (this.globalShortcut) {
      for (const [, info] of this.registered) {
        if (info.via === 'global') {
          try {
            this.globalShortcut.unregister(info.accelerator)
          } catch {
            /* ignore */
          }
        }
      }
    }
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

  private tryGlobalShortcut(action: AppShortcutAction, accelerator: string): boolean | 'invalid' {
    if (!this.globalShortcut) return false
    try {
      return this.globalShortcut.register(accelerator, this.actions[action])
    } catch {
      return 'invalid'
    }
  }

  /**
   * 注册单个快捷键，返回其状态。
   *
   * macOS：
   *  - 已授予「输入监控」且有底层钩子 → 用底层钩子（可拦截被系统占用的组合键，如 Command+Space）→ via:'hook'
   *  - 未授权 → 退回 globalShortcut（无需任何权限，基础快捷键即时可用）；若连 globalShortcut 也注册不上
   *    （通常是系统保留组合键），则诚实返回 reason:'permission'，引导用户授予「输入监控」
   * Windows/Linux：globalShortcut 优先，被占用/保留时退回底层钩子（WH_KEYBOARD_LL，无需权限）
   */
  private registerOne(
    action: AppShortcutAction,
    accelerator: string,
    reserved: ReturnType<typeof detectSystemReservedShortcut>
  ): ShortcutStatus {
    if (this.platform === 'darwin') {
      const hookUsable = this.hookUsableOnDarwin()

      if (hookUsable && this.inputHook) {
        if (this.registerHook(action, accelerator)) {
          this.registered.set(action, { accelerator, via: 'hook' })
          return { ok: true, via: 'hook' }
        }
        // 钩子异常失败 → 退回 globalShortcut
      }

      const globalResult = this.tryGlobalShortcut(action, accelerator)
      if (globalResult === true) {
        this.registered.set(action, { accelerator, via: 'global' })
        return { ok: true }
      }
      if (globalResult === 'invalid') {
        return { ok: false, reason: 'invalid' }
      }

      // globalShortcut 注册不上：未授权时多半是底层钩子才能接管的系统保留键 → 引导授予权限
      if (!hookUsable) {
        return { ok: false, reason: 'permission' }
      }
      return { ok: false, reason: 'in-use' }
    }

    // Windows / Linux：globalShortcut 优先
    if (!reserved) {
      const globalResult = this.tryGlobalShortcut(action, accelerator)
      if (globalResult === true) {
        this.registered.set(action, { accelerator, via: 'global' })
        return { ok: true }
      }
      if (globalResult === 'invalid') {
        return { ok: false, reason: 'invalid' }
      }
    }

    // globalShortcut 不可用 / 被占用 / 系统保留 → 退回底层钩子
    if (this.registerHook(action, accelerator)) {
      this.registered.set(action, { accelerator, via: 'hook' })
      return { ok: true, via: 'hook' }
    }

    return { ok: false, reason: reserved ? 'system-reserved' : 'in-use' }
  }

  apply(shortcuts: AppShortcutSettings): ShortcutStatusMap {
    if (this.paused) {
      return this.status
    }

    this.unregisterKeyboard()

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

      const reserved = detectSystemReservedShortcut(accelerator, this.platform)
      const status = this.registerOne(action, accelerator, reserved)
      nextStatus[action] = status

      // 已成功注册，或虽未生效但已占用该组合键（permission），都视为已占用，避免另一动作重复注册同一键
      if (status.ok || status.reason === 'permission') {
        used.set(key, action)
      }
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

  /**
   * 当前配置是否依赖底层输入钩子（从而需要 macOS「输入监控」权限）。
   * 用于决定是否提示用户授予权限：基础快捷键已由 globalShortcut 兜底，无需此权限。
   */
  isHookNeeded(): boolean {
    const hookShortcut = Object.values(this.status).some(
      (s) => (s.ok && s.via === 'hook') || (!s.ok && s.reason === 'permission')
    )
    const mouse = this.currentMouseTrigger?.enabled === true
    const doubleTap = this.currentDoubleTap?.enabled === true
    return hookShortcut || mouse || doubleTap
  }

  pause() {
    if (this.paused) return
    this.unregisterKeyboard()
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
    this.unregisterKeyboard()
    this.unregisterMouseTrigger()
    this.unregisterDoubleTap()
  }
}
