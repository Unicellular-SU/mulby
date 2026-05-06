import { BrowserWindow } from 'electron'

/**
 * Blur 状态管理器
 * 
 * 用于在特定场景下（如打开系统对话框）临时禁用窗口 blur 事件导致的隐藏行为，
 * 并临时隐藏 alwaysOnTop 的窗口以避免遮挡系统对话框。
 */

let ignoringBlur = false
let ignoreCount = 0 // 支持嵌套调用
let hiddenWindows: BrowserWindow[] = []

// Track whether the app was hidden via app.hide() on macOS.
// MainWindowManager.show() uses this to decide if app.show() is needed
// (calling app.show() unconditionally triggers Stage Manager window rearrangement).
let appExplicitlyHidden = false

let getWindowsToHide: (() => BrowserWindow[]) | null = null
let getHasDetachedWindows: (() => boolean) | null = null

/**
 * 设置获取需要隐藏的窗口的函数
 * 应该在应用初始化时调用
 */
export function setWindowsProvider(provider: () => BrowserWindow[]): void {
    getWindowsToHide = provider
}

/**
 * 设置获取是否存在独立窗口的函数
 */
export function setHasDetachedWindowsProvider(provider: () => boolean): void {
    getHasDetachedWindows = provider
}

/**
 * 获取是否存在独立窗口
 */
export function hasDetachedWindows(): boolean {
    return getHasDetachedWindows ? getHasDetachedWindows() : false
}

export interface HideWholeAppAfterWindowHideInput {
    platform: NodeJS.Platform
    restorePreviousWindow: boolean
    hasOtherVisibleWindows: boolean
    hasDetachedWindows: boolean
}

export function shouldHideWholeAppAfterWindowHide(
    input: HideWholeAppAfterWindowHideInput
): boolean {
    return input.platform === 'darwin'
        && input.restorePreviousWindow
        && !input.hasOtherVisibleWindows
        && !input.hasDetachedWindows
}

/**
 * 开始忽略 blur 事件
 */
export function startIgnoringBlur(): void {
    ignoreCount++
    ignoringBlur = true
}

/**
 * 停止忽略 blur 事件
 */
export function stopIgnoringBlur(): void {
    ignoreCount = Math.max(0, ignoreCount - 1)
    if (ignoreCount === 0) {
        // 延迟恢复，确保焦点转移完成
        setTimeout(() => {
            if (ignoreCount === 0) {
                ignoringBlur = false
            }
        }, 100)
    }
}

/**
 * 检查当前是否正在忽略 blur 事件
 */
export function isIgnoringBlur(): boolean {
    return ignoringBlur
}

/**
 * 临时隐藏指定窗口（用于系统对话框场景）
 */
function temporarilyHideWindows(): void {
    if (!getWindowsToHide) return
    const windows = getWindowsToHide()
    hiddenWindows = windows.filter(w => w && !w.isDestroyed() && w.isVisible())
    for (const win of hiddenWindows) {
        win.hide()
    }
}

/**
 * 恢复之前临时隐藏的窗口
 */
function restoreHiddenWindows(): void {
    for (const win of hiddenWindows) {
        if (!win.isDestroyed()) {
            win.showInactive()
        }
    }
    hiddenWindows = []
}

/**
 * 在异步操作期间忽略 blur 事件并临时隐藏窗口的包装器
 * 用于系统对话框等需要避免遮挡的场景
 * 
 * @param windows 可选，指定需要隐藏的窗口列表。如果不传，则使用全局 provider
 */
export async function withDialogMode<T>(
    windowsOrFn: BrowserWindow[] | (() => Promise<T>),
    fn?: () => Promise<T>
): Promise<T> {
    // 支持两种调用方式：withDialogMode(windows, fn) 或 withDialogMode(fn)
    let windows: BrowserWindow[] | null = null
    let actualFn: () => Promise<T>

    if (typeof windowsOrFn === 'function') {
        actualFn = windowsOrFn
    } else {
        windows = windowsOrFn
        actualFn = fn!
    }

    startIgnoringBlur()

    // 临时隐藏窗口
    if (windows) {
        hiddenWindows = windows.filter(w => w && !w.isDestroyed() && w.isVisible())
        for (const win of hiddenWindows) {
            win.hide()
        }
    } else {
        temporarilyHideWindows()
    }

    try {
        return await actualFn()
    } finally {
        restoreHiddenWindows()
        stopIgnoringBlur()
    }
}

export function markAppHidden(): void {
    appExplicitlyHidden = true
}

export function markAppVisible(): void {
    appExplicitlyHidden = false
}

export function isAppExplicitlyHidden(): boolean {
    return appExplicitlyHidden
}

/**
 * 简单的 blur 忽略包装器（不隐藏窗口）
 */
export async function withIgnoringBlur<T>(fn: () => Promise<T>): Promise<T> {
    startIgnoringBlur()
    try {
        return await fn()
    } finally {
        stopIgnoringBlur()
    }
}
