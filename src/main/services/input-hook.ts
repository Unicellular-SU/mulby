/**
 * 统一输入钩子服务（键盘 + 鼠标 + 双击修饰键）
 *
 * 作为 uIOhook 的唯一所有者，统一管理 start()/stop() 生命周期。
 *
 * 功能：
 * - 键盘钩子：当 Electron globalShortcut.register() 因占用失败时，
 *   使用底层钩子（WH_KEYBOARD_LL / CGEventTap）绕过限制。
 * - 鼠标钩子：支持鼠标按钮（中键/侧键）的单击和长按检测。
 * - 双击修饰键检测：检测修饰键的快速双击模式（移植自 ZTools DoubleTapManager）。
 *
 * 注意：uiohook-napi 无法抑制事件传播（JS 事件是 native 事件的拷贝），
 * 其他已注册同一快捷键的应用仍会收到按键事件。
 */
import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from 'uiohook-napi'

// ==================== 键盘部分 ====================

// Electron accelerator 中的键名 → uiohook keycode 映射
const ELECTRON_KEY_TO_UIOHOOK: Record<string, number> = {
  space: UiohookKey.Space,
  enter: UiohookKey.Enter,
  return: UiohookKey.Enter,
  tab: UiohookKey.Tab,
  escape: UiohookKey.Escape,
  esc: UiohookKey.Escape,
  backspace: UiohookKey.Backspace,
  delete: UiohookKey.Delete,
  insert: UiohookKey.Insert,
  home: UiohookKey.Home,
  end: UiohookKey.End,
  pageup: UiohookKey.PageUp,
  pagedown: UiohookKey.PageDown,
  up: UiohookKey.ArrowUp,
  down: UiohookKey.ArrowDown,
  left: UiohookKey.ArrowLeft,
  right: UiohookKey.ArrowRight,
  f1: UiohookKey.F1,
  f2: UiohookKey.F2,
  f3: UiohookKey.F3,
  f4: UiohookKey.F4,
  f5: UiohookKey.F5,
  f6: UiohookKey.F6,
  f7: UiohookKey.F7,
  f8: UiohookKey.F8,
  f9: UiohookKey.F9,
  f10: UiohookKey.F10,
  f11: UiohookKey.F11,
  f12: UiohookKey.F12,
  // 字母键
  a: UiohookKey.A, b: UiohookKey.B, c: UiohookKey.C, d: UiohookKey.D,
  e: UiohookKey.E, f: UiohookKey.F, g: UiohookKey.G, h: UiohookKey.H,
  i: UiohookKey.I, j: UiohookKey.J, k: UiohookKey.K, l: UiohookKey.L,
  m: UiohookKey.M, n: UiohookKey.N, o: UiohookKey.O, p: UiohookKey.P,
  q: UiohookKey.Q, r: UiohookKey.R, s: UiohookKey.S, t: UiohookKey.T,
  u: UiohookKey.U, v: UiohookKey.V, w: UiohookKey.W, x: UiohookKey.X,
  y: UiohookKey.Y, z: UiohookKey.Z,
  // 数字键
  '0': UiohookKey[0], '1': UiohookKey[1], '2': UiohookKey[2],
  '3': UiohookKey[3], '4': UiohookKey[4], '5': UiohookKey[5],
  '6': UiohookKey[6], '7': UiohookKey[7], '8': UiohookKey[8],
  '9': UiohookKey[9],
  // 符号键
  '-': UiohookKey.Minus,
  '=': UiohookKey.Equal,
  '[': UiohookKey.BracketLeft,
  ']': UiohookKey.BracketRight,
  '\\': UiohookKey.Backslash,
  ';': UiohookKey.Semicolon,
  '\'': UiohookKey.Quote,
  '`': UiohookKey.Backquote,
  ',': UiohookKey.Comma,
  '.': UiohookKey.Period,
  '/': UiohookKey.Slash,
  minus: UiohookKey.Minus,
  plus: UiohookKey.Equal,
  equal: UiohookKey.Equal,
}

/**
 * 解析 Electron accelerator 格式为 { keycode, alt, ctrl, meta, shift }
 * 例如 "Alt+Space" → { keycode: 57, alt: true, ctrl: false, meta: false, shift: false }
 */
interface ParsedAccelerator {
  keycode: number
  alt: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
}

function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  const parts = accelerator.split('+').map(p => p.trim().toLowerCase())
  let alt = false, ctrl = false, meta = false, shift = false
  let keycode = -1

  for (const part of parts) {
    switch (part) {
      case 'alt':
      case 'option':
        alt = true
        break
      case 'ctrl':
      case 'control':
      case 'commandorcontrol':
      case 'cmdorctrl':
        // 在 macOS 上 CommandOrControl 映射到 Meta，在 Windows 上映射到 Ctrl
        if (process.platform === 'darwin') {
          meta = true
        } else {
          ctrl = true
        }
        break
      case 'command':
      case 'cmd':
      case 'meta':
      case 'super':
        meta = true
        break
      case 'shift':
        shift = true
        break
      default: {
        const code = ELECTRON_KEY_TO_UIOHOOK[part]
        if (code != null) {
          keycode = code
        } else {
          // 未知键名，无法解析
          console.warn(`[InputHook] 无法解析键名: "${part}"`)
          return null
        }
      }
    }
  }

  if (keycode === -1) return null
  return { keycode, alt, ctrl, meta, shift }
}

interface HookBinding {
  parsed: ParsedAccelerator
  callback: () => void
}

// ==================== 鼠标部分（P2-A） ====================

/** 鼠标按钮名称 */
export type MouseButton = 'left' | 'right' | 'middle' | 'back' | 'forward'

/** 鼠标触发动作 */
export type MouseAction = 'click' | 'longpress'

/** 鼠标事件回调数据 */
export interface MouseEventData {
  x: number
  y: number
  button: MouseButton
}

interface MouseBinding {
  button: MouseButton
  action: MouseAction
  longPressMs: number
  callback: (event: MouseEventData) => void
}

/**
 * uiohook-napi 鼠标按钮编号 → 按钮名称映射
 * 运行时 UiohookMouseEvent.button 是数字（类型标注为 unknown）
 */
const MOUSE_BUTTON_MAP: Record<number, MouseButton> = {
  1: 'left',
  2: 'right',
  3: 'middle',
  4: 'back',
  5: 'forward',
}

/** 反向映射：按钮名称 → 数字（用于 matchButton） */
function matchButton(eventButton: unknown, bindingButton: MouseButton): boolean {
  const name = MOUSE_BUTTON_MAP[eventButton as number]
  return name === bindingButton
}

// ==================== 双击修饰键部分（P2-B） ====================

/**
 * uiohook keycode → 修饰键名称映射
 * 左右修饰键统一映射到同一名称
 */
const MODIFIER_KEYCODES: Record<number, string> = {
  [UiohookKey.Meta]: 'Command',
  [UiohookKey.MetaRight]: 'Command',
  [UiohookKey.Ctrl]: 'Ctrl',
  [UiohookKey.CtrlRight]: 'Ctrl',
  [UiohookKey.Alt]: 'Alt',
  [UiohookKey.AltRight]: 'Alt',
  [UiohookKey.Shift]: 'Shift',
  [UiohookKey.ShiftRight]: 'Shift',
}

interface DoubleTapHandler {
  modifier: string
  callback: () => void
}

/**
 * 双击修饰键检测器（状态机）
 * 移植自 ZTools DoubleTapManager，但不再独立管理 uIOhook 生命周期。
 * 由 InputHookService 的 keydown/keyup 事件驱动。
 */
class DoubleTapDetector {
  private handlers: DoubleTapHandler[] = []
  private lastModifierUp: { modifier: string; time: number } | null = null
  private nonModifierPressed = false
  private modifierDownTime = 0

  // 双击最大间隔（毫秒）
  private readonly DOUBLE_TAP_INTERVAL = 400
  // 单次按键最大持续时间（超过则视为长按，非 tap）
  private readonly MAX_TAP_DURATION = 300

  /** 注册双击修饰键回调 */
  register(modifier: string, callback: () => void): void {
    // 移除同一修饰键的旧回调
    this.handlers = this.handlers.filter(h => h.modifier !== modifier)
    this.handlers.push({ modifier, callback })
  }

  /** 注销指定修饰键的回调 */
  unregister(modifier: string): void {
    this.handlers = this.handlers.filter(h => h.modifier !== modifier)
  }

  /** 注销所有回调 */
  unregisterAll(): void {
    this.handlers = []
    this.reset()
  }

  /** 是否有任何注册的回调 */
  hasHandlers(): boolean {
    return this.handlers.length > 0
  }

  /** 重置检测状态 */
  reset(): void {
    this.lastModifierUp = null
    this.nonModifierPressed = false
    this.modifierDownTime = 0
  }

  /** 处理 keydown 事件（由 InputHookService 调用） */
  handleKeyDown(keycode: number): void {
    if (this.handlers.length === 0) return

    const modifier = MODIFIER_KEYCODES[keycode]
    if (modifier) {
      if (this.modifierDownTime === 0) {
        this.modifierDownTime = Date.now()
      }
    } else {
      // 非修饰键被按下，重置双击检测状态
      this.nonModifierPressed = true
      this.lastModifierUp = null
    }
  }

  /** 处理 keyup 事件（由 InputHookService 调用） */
  handleKeyUp(keycode: number): void {
    if (this.handlers.length === 0) return

    const modifier = MODIFIER_KEYCODES[keycode]
    if (!modifier) {
      // 非修饰键 keyup：不清除任何状态。
      // nonModifierPressed 标记由 handleKeyDown 设置，
      // 必须保留到修饰键 keyup 时才检查，否则 Ctrl+C 等组合键
      // 中 C 先释放会清除标记，导致后续 Ctrl 释放被误判为 tap。
      return
    }

    const now = Date.now()

    // 按键时间过长（长按），不算 tap
    if (this.modifierDownTime > 0 && now - this.modifierDownTime > this.MAX_TAP_DURATION) {
      this.modifierDownTime = 0
      this.nonModifierPressed = false
      this.lastModifierUp = null
      return
    }
    this.modifierDownTime = 0

    // 期间有非修饰键按下，不算 tap
    if (this.nonModifierPressed) {
      this.nonModifierPressed = false
      this.lastModifierUp = null
      return
    }

    // 检查是否为双击
    if (
      this.lastModifierUp &&
      this.lastModifierUp.modifier === modifier &&
      now - this.lastModifierUp.time < this.DOUBLE_TAP_INTERVAL
    ) {
      this.lastModifierUp = null
      this.fireHandlers(modifier)
      return
    }

    // 记录为第一次 tap
    this.lastModifierUp = { modifier, time: now }
  }

  /** 触发匹配的回调 */
  private fireHandlers(modifier: string): void {
    for (const handler of this.handlers) {
      if (handler.modifier === modifier) {
        try {
          handler.callback()
        } catch (error) {
          console.error(`[InputHook] 双击修饰键回调执行失败 (${modifier}):`, error)
        }
      }
    }
  }
}

// ==================== InputHookService ====================

export class InputHookService {
  // 键盘绑定
  private keyBindings = new Map<string, HookBinding>()
  // 鼠标绑定
  private mouseBindings = new Map<string, MouseBinding>()
  // 鼠标长按定时器（key = `${bindingId}`）
  private mouseDownTimers = new Map<string, NodeJS.Timeout>()
  // 鼠标长按已触发标记（防止 mouseUp 时重复触发 click）
  private longPressFired = new Set<string>()
  // 双击修饰键检测器
  private doubleTap = new DoubleTapDetector()
  // uIOhook 运行状态
  private running = false

  // ---- 键盘事件处理 ----

  private onKeyDown = (event: UiohookKeyboardEvent) => {
    // 键盘绑定匹配
    for (const [, binding] of this.keyBindings) {
      const { parsed, callback } = binding
      if (
        event.keycode === parsed.keycode &&
        event.altKey === parsed.alt &&
        event.ctrlKey === parsed.ctrl &&
        event.metaKey === parsed.meta &&
        event.shiftKey === parsed.shift
      ) {
        callback()
      }
    }

    // 驱动双击修饰键状态机
    this.doubleTap.handleKeyDown(event.keycode)
  }

  private onKeyUp = (event: UiohookKeyboardEvent) => {
    // 驱动双击修饰键状态机
    this.doubleTap.handleKeyUp(event.keycode)
  }

  // ---- 鼠标事件处理 ----

  private onMouseDown = (event: UiohookMouseEvent) => {
    for (const [id, binding] of this.mouseBindings) {
      if (!matchButton(event.button, binding.button)) continue

      if (binding.action === 'longpress') {
        // 长按检测：设置定时器，到期后触发
        const timer = setTimeout(() => {
          this.longPressFired.add(id)
          this.mouseDownTimers.delete(id)
          binding.callback({ x: event.x, y: event.y, button: binding.button })
        }, binding.longPressMs)
        this.mouseDownTimers.set(id, timer)
      }
    }
  }

  private onMouseUp = (event: UiohookMouseEvent) => {
    for (const [id, binding] of this.mouseBindings) {
      if (!matchButton(event.button, binding.button)) continue

      // 清除长按定时器
      const timer = this.mouseDownTimers.get(id)
      if (timer) {
        clearTimeout(timer)
        this.mouseDownTimers.delete(id)
      }

      // 如果长按已触发，不再触发 click
      if (this.longPressFired.has(id)) {
        this.longPressFired.delete(id)
        continue
      }

      // 点击检测：仅 click 模式在 mouseUp 时触发
      if (binding.action === 'click') {
        binding.callback({ x: event.x, y: event.y, button: binding.button })
      }
    }
  }

  // ---- 键盘绑定 API ----

  /**
   * 为指定 accelerator 注册底层键盘钩子
   * @returns true 表示注册成功
   */
  register(id: string, accelerator: string, callback: () => void): boolean {
    const parsed = parseAccelerator(accelerator)
    if (!parsed) {
      console.warn(`[InputHook] 无法解析 accelerator: "${accelerator}"`)
      return false
    }

    this.keyBindings.set(id, { parsed, callback })

    if (!this.running && !this.startHook()) {
      this.keyBindings.delete(id)
      return false
    }

    console.log(`[InputHook] 注册键盘钩子: ${id} → ${accelerator}`)
    return true
  }

  /** 注销指定 id 的键盘钩子 */
  unregister(id: string): void {
    if (this.keyBindings.delete(id)) {
      console.log(`[InputHook] 注销键盘钩子: ${id}`)
    }
    this.stopIfEmpty()
  }

  /** 检查指定键盘 id 是否已注册 */
  isRegistered(id: string): boolean {
    return this.keyBindings.has(id)
  }

  // ---- 鼠标绑定 API（P2-A） ----

  /**
   * 注册鼠标按钮钩子
   * @param id 绑定标识
   * @param button 鼠标按钮名称
   * @param action 触发方式：click 或 longpress
   * @param callback 回调函数
   * @param longPressMs 长按阈值（毫秒），仅 longpress 模式生效，默认 500
   * @returns true 表示注册成功
   */
  registerMouse(
    id: string,
    button: MouseButton,
    action: MouseAction,
    callback: (event: MouseEventData) => void,
    longPressMs = 500
  ): boolean {
    this.mouseBindings.set(id, { button, action, longPressMs, callback })

    if (!this.running && !this.startHook()) {
      this.mouseBindings.delete(id)
      return false
    }

    console.log(`[InputHook] 注册鼠标钩子: ${id} → ${button} (${action})`)
    return true
  }

  /** 注销指定 id 的鼠标钩子 */
  unregisterMouse(id: string): void {
    if (this.mouseBindings.delete(id)) {
      // 清理相关定时器和状态
      const timer = this.mouseDownTimers.get(id)
      if (timer) {
        clearTimeout(timer)
        this.mouseDownTimers.delete(id)
      }
      this.longPressFired.delete(id)
      console.log(`[InputHook] 注销鼠标钩子: ${id}`)
    }
    this.stopIfEmpty()
  }

  // ---- 双击修饰键 API（P2-B） ----

  /**
   * 注册双击修饰键回调
   * @param modifier 修饰键名称（如 "Command"、"Ctrl"、"Alt"、"Shift"）
   * @param callback 双击时触发的回调
   */
  registerDoubleTap(modifier: string, callback: () => void): boolean {
    this.doubleTap.register(modifier, callback)

    if (!this.running && !this.startHook()) {
      this.doubleTap.unregister(modifier)
      return false
    }

    console.log(`[InputHook] 注册双击修饰键: ${modifier}`)
    return true
  }

  /** 注销指定修饰键的双击回调 */
  unregisterDoubleTap(modifier: string): void {
    this.doubleTap.unregister(modifier)
    console.log(`[InputHook] 注销双击修饰键: ${modifier}`)
    this.stopIfEmpty()
  }

  // ---- 通用管理 API ----

  /** 注销所有键盘钩子（不影响鼠标和双击修饰键） */
  unregisterAll(): void {
    this.keyBindings.clear()
    this.stopIfEmpty()
  }

  /** 注销所有键盘 + 鼠标 + 双击修饰键 */
  unregisterEverything(): void {
    this.keyBindings.clear()
    this.clearAllMouseState()
    this.mouseBindings.clear()
    this.doubleTap.unregisterAll()
    if (this.running) {
      this.stopHook()
    }
  }

  /** 检查是否有活跃的绑定 */
  hasBindings(): boolean {
    return this.keyBindings.size > 0 || this.mouseBindings.size > 0 || this.doubleTap.hasHandlers()
  }

  /** 销毁服务，清理所有资源 */
  destroy(): void {
    this.unregisterEverything()
  }

  // ---- 内部方法 ----

  /** 清除所有鼠标相关状态 */
  private clearAllMouseState(): void {
    for (const timer of this.mouseDownTimers.values()) {
      clearTimeout(timer)
    }
    this.mouseDownTimers.clear()
    this.longPressFired.clear()
  }

  /** 如果没有任何绑定，则停止钩子 */
  private stopIfEmpty(): void {
    if (!this.hasBindings() && this.running) {
      this.stopHook()
    }
  }

  /** 启动 uIOhook（注册所有事件监听器） */
  private startHook(): boolean {
    if (this.running) return true
    try {
      uIOhook.on('keydown', this.onKeyDown)
      uIOhook.on('keyup', this.onKeyUp)
      uIOhook.on('mousedown', this.onMouseDown)
      uIOhook.on('mouseup', this.onMouseUp)
      uIOhook.start()
      this.running = true
      console.log('[InputHook] 底层输入钩子已启动')
      return true
    } catch (err) {
      console.error('[InputHook] 启动钩子失败:', err)
      uIOhook.off('keydown', this.onKeyDown)
      uIOhook.off('keyup', this.onKeyUp)
      uIOhook.off('mousedown', this.onMouseDown)
      uIOhook.off('mouseup', this.onMouseUp)
      return false
    }
  }

  /** 停止 uIOhook（移除所有事件监听器） */
  private stopHook(): void {
    if (!this.running) return
    try {
      uIOhook.off('keydown', this.onKeyDown)
      uIOhook.off('keyup', this.onKeyUp)
      uIOhook.off('mousedown', this.onMouseDown)
      uIOhook.off('mouseup', this.onMouseUp)
      uIOhook.stop()
      this.running = false
      this.doubleTap.reset()
      this.clearAllMouseState()
      console.log('[InputHook] 底层输入钩子已停止')
    } catch (err) {
      console.error('[InputHook] 停止钩子失败:', err)
    }
  }
}
