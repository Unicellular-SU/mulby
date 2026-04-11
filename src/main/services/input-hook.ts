/**
 * 统一输入钩子服务（键盘 + 鼠标 + 双击修饰键）
 *
 * 作为原生输入钩子的唯一所有者，统一管理 start()/stop() 生命周期。
 *
 * 功能：
 * - 键盘钩子：当 Electron globalShortcut.register() 因占用失败时，
 *   使用底层钩子（WH_KEYBOARD_LL / CGEventTap）绕过限制。
 * - 鼠标钩子：支持鼠标按钮（中键/侧键）的单击和长按检测。
 * - 双击修饰键检测：检测修饰键的快速双击模式（移植自 ZTools DoubleTapManager）。
 *
 * 底层实现：通过 koffi FFI 调用系统原生 API（无 uiohook-napi 依赖）。
 * Windows: SetWindowsHookEx (WH_KEYBOARD_LL / WH_MOUSE_LL)
 * macOS:   CGEventTapCreate
 */
import {
  startNativeInputHook,
  stopNativeInputHook,
  ELECTRON_KEY_TO_VK,
  VK_MODIFIER_MAP,
  type NativeKeyEvent,
  type NativeMouseEvent
} from './native-input-hook'

// ==================== 键盘部分 ====================

/**
 * 解析 Electron accelerator 格式为 { vkCode, alt, ctrl, meta, shift }
 * 例如 "Alt+Space" → { vkCode: 0x20, alt: true, ctrl: false, meta: false, shift: false }
 */
interface ParsedAccelerator {
  vkCode: number
  alt: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
}

function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  const parts = accelerator.split('+').map(p => p.trim().toLowerCase())
  let alt = false, ctrl = false, meta = false, shift = false
  let vkCode = -1

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
        const code = ELECTRON_KEY_TO_VK[part]
        if (code != null) {
          vkCode = code
        } else {
          // 未知键名，无法解析
          console.warn(`[InputHook] 无法解析键名: "${part}"`)
          return null
        }
      }
    }
  }

  if (vkCode === -1) return null
  return { vkCode, alt, ctrl, meta, shift }
}

interface HookBinding {
  parsed: ParsedAccelerator
  callback: () => void
}

// ==================== 鼠标部分 ====================

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
 * NativeMouseEvent.button 编号 → MouseButton 名称映射
 * 与原 uiohook-napi 的映射保持一致
 */
const MOUSE_BUTTON_MAP: Record<number, MouseButton> = {
  1: 'left',
  2: 'right',
  3: 'middle',
  4: 'back',
  5: 'forward',
}

/** 匹配鼠标按钮 */
function matchButton(eventButton: number, bindingButton: MouseButton): boolean {
  const name = MOUSE_BUTTON_MAP[eventButton]
  return name === bindingButton
}

// ==================== 双击修饰键部分 ====================

interface DoubleTapHandler {
  modifier: string
  callback: () => void
}

/**
 * 双击修饰键检测器（状态机）
 * 移植自 ZTools DoubleTapManager。
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

  /**
   * 抱制模拟键盘事件对双击检测的干扰。
   *
   * macOS CGEventTap 会异步捕获模拟的 Cmd+C 事件，其中 C 键 (vk=67)
   * 的 keydown 会设置 nonModifierPressed=true。由于 CGEventTap 回调通过
   * macOS RunLoop 送达，延迟通常 10-50ms，无法用 nextTick/setTimeout 精确重置。
   * 因此采用时间窗口抱制：在指定时间内忽略非修饰键 keydown。
   *
   * @param durationMs 抱制窗口时长（毫秒）
   */
  private suppressUntil = 0

  suppressSyntheticInputs(durationMs: number): void {
    this.suppressUntil = Date.now() + durationMs
  }

  /** 处理 keydown 事件（由 InputHookService 调用） */
  handleKeyDown(vkCode: number): void {
    if (this.handlers.length === 0) return

    const modifier = VK_MODIFIER_MAP[vkCode]

    if (modifier) {
      if (this.modifierDownTime === 0) {
        this.modifierDownTime = Date.now()
      }
    } else {
      // 在抑制窗口内忽略非修饰键 keydown（模拟键盘产生的合成事件）
      if (Date.now() < this.suppressUntil) {
        return
      }
      // 非修饰键被按下，重置双击检测状态
      this.nonModifierPressed = true
      this.lastModifierUp = null
    }
  }

  /** 处理 keyup 事件（由 InputHookService 调用） */
  handleKeyUp(vkCode: number): void {
    if (this.handlers.length === 0) return

    const modifier = VK_MODIFIER_MAP[vkCode]

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
  // 原生钩子运行状态
  private running = false

  // ---- 键盘事件处理 ----

  private onKeyDown = (event: NativeKeyEvent) => {
    // 键盘绑定匹配
    for (const [, binding] of this.keyBindings) {
      const { parsed, callback } = binding
      if (
        event.vkCode === parsed.vkCode &&
        event.altKey === parsed.alt &&
        event.ctrlKey === parsed.ctrl &&
        event.metaKey === parsed.meta &&
        event.shiftKey === parsed.shift
      ) {
        callback()
      }
    }

    // 驱动双击修饰键状态机
    this.doubleTap.handleKeyDown(event.vkCode)
  }

  private onKeyUp = (event: NativeKeyEvent) => {
    // 驱动双击修饰键状态机
    this.doubleTap.handleKeyUp(event.vkCode)
  }

  // ---- 鼠标事件处理 ----

  private onMouseDown = (event: NativeMouseEvent) => {
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

  private onMouseUp = (event: NativeMouseEvent) => {
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

  // ---- 鼠标绑定 API ----

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

  // ---- 双击修饰键 API ----

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

  /**
   * 在模拟键盘操作前调用，抑制合成事件对双击检测的干扰。
   * @param durationMs 抑制窗口时长（毫秒），默认 100ms
   */
  suppressDoubleTapForSyntheticInput(durationMs = 100): void {
    this.doubleTap.suppressSyntheticInputs(durationMs)
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

  /** 启动原生输入钩子 */
  private startHook(): boolean {
    if (this.running) return true
    try {
      const ok = startNativeInputHook({
        onKeyDown: this.onKeyDown,
        onKeyUp: this.onKeyUp,
        onMouseDown: this.onMouseDown,
        onMouseUp: this.onMouseUp
      })

      if (!ok) {
        console.error('[InputHook] 启动原生钩子失败')
        return false
      }

      this.running = true
      console.log('[InputHook] 底层输入钩子已启动 (koffi)')
      return true
    } catch (err) {
      console.error('[InputHook] 启动钩子失败:', err)
      return false
    }
  }

  /** 停止原生输入钩子 */
  private stopHook(): void {
    if (!this.running) return
    try {
      stopNativeInputHook()
      this.running = false
      this.doubleTap.reset()
      this.clearAllMouseState()
      console.log('[InputHook] 底层输入钩子已停止')
    } catch (err) {
      console.error('[InputHook] 停止钩子失败:', err)
    }
  }
}
