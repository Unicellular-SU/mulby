/**
 * 底层键盘钩子服务
 *
 * 当 Electron 的 globalShortcut.register() 因其他应用占用而失败时，
 * 使用底层键盘钩子（Windows: WH_KEYBOARD_LL / macOS: CGEventTap）
 * 绕过 RegisterHotKey 限制，检测到目标组合键时触发回调。
 *
 * 注意：uiohook-napi 无法抑制事件传播（JS 事件是 native 事件的拷贝），
 * 因此其他已注册同一快捷键的应用仍会收到按键事件。
 * 本服务的价值在于：即使其他应用占用了快捷键，Mulby 依然能响应。
 */
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'

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
          console.warn(`[KeyboardHook] 无法解析键名: "${part}"`)
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

export class KeyboardHookService {
  private bindings = new Map<string, HookBinding>()
  private running = false

  private onKeyDown = (event: UiohookKeyboardEvent) => {
    for (const [, binding] of this.bindings) {
      const { parsed, callback } = binding
      if (
        event.keycode === parsed.keycode &&
        event.altKey === parsed.alt &&
        event.ctrlKey === parsed.ctrl &&
        event.metaKey === parsed.meta &&
        event.shiftKey === parsed.shift
      ) {
        // 注意：uiohook-napi 无法抑制事件传播，其他应用仍会收到按键。
        // 这里仅保证 Mulby 也能响应。
        callback()
      }
    }
  }

  /**
   * 为指定 accelerator 注册底层钩子
   * @returns true 表示注册成功（钩子已启动且绑定已记录）
   */
  register(id: string, accelerator: string, callback: () => void): boolean {
    const parsed = parseAccelerator(accelerator)
    if (!parsed) {
      console.warn(`[KeyboardHook] 无法解析 accelerator: "${accelerator}"`)
      return false
    }

    this.bindings.set(id, { parsed, callback })

    // 如果还没启动钩子，启动它
    if (!this.running) {
      if (!this.startHook()) {
        // 钩子启动失败，回滚绑定
        this.bindings.delete(id)
        return false
      }
    }

    console.log(`[KeyboardHook] 注册钩子: ${id} → ${accelerator}`)
    return true
  }

  /**
   * 注销指定 id 的钩子
   */
  unregister(id: string): void {
    if (this.bindings.delete(id)) {
      console.log(`[KeyboardHook] 注销钩子: ${id}`)
    }

    // 没有任何绑定时停止钩子，节省资源
    if (this.bindings.size === 0 && this.running) {
      this.stopHook()
    }
  }

  /**
   * 注销所有钩子
   */
  unregisterAll(): void {
    this.bindings.clear()
    if (this.running) {
      this.stopHook()
    }
  }

  /**
   * 检查是否有活跃的钩子绑定
   */
  hasBindings(): boolean {
    return this.bindings.size > 0
  }

  /**
   * 检查指定 id 是否已注册
   */
  isRegistered(id: string): boolean {
    return this.bindings.has(id)
  }

  /**
   * @returns true 表示启动成功
   */
  private startHook(): boolean {
    if (this.running) return true
    try {
      uIOhook.on('keydown', this.onKeyDown)
      uIOhook.start()
      this.running = true
      console.log('[KeyboardHook] 底层键盘钩子已启动')
      return true
    } catch (err) {
      console.error('[KeyboardHook] 启动钩子失败:', err)
      uIOhook.off('keydown', this.onKeyDown)
      return false
    }
  }

  private stopHook(): void {
    if (!this.running) return
    try {
      uIOhook.off('keydown', this.onKeyDown)
      uIOhook.stop()
      this.running = false
      console.log('[KeyboardHook] 底层键盘钩子已停止')
    } catch (err) {
      console.error('[KeyboardHook] 停止钩子失败:', err)
    }
  }

  /**
   * 销毁服务，清理所有资源
   */
  destroy(): void {
    this.unregisterAll()
  }
}
