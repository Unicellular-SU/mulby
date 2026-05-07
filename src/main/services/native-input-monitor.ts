/**
 * native-input-monitor.ts — 原生全局输入监听模块 TS 封装
 *
 * 封装 C++ N-API 原生模块，提供类型安全的全局鼠标/键盘事件监听。
 * 自动处理：
 *   - 原生模块加载（开发/生产环境路径差异）
 *   - 加载失败时的优雅降级
 *   - 单实例共享 + 引用计数
 */

import log from 'electron-log'
import { screen } from 'electron'
import { getNativeBuildAddonPathCandidates } from './native-addon-path'

export interface GlobalInputEvent {
  type: 'mouseMove' | 'mouseDown' | 'mouseUp' | 'mouseScroll' | 'keyDown' | 'keyUp'
  timestamp: number
  x: number
  y: number
  button?: 'left' | 'right' | 'middle'
  clickCount?: number
  scrollDeltaX?: number
  scrollDeltaY?: number
  keyCode?: number
  key?: string
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

export interface InputMonitorOptions {
  mouse?: boolean
  keyboard?: boolean
  throttleMs?: number
}

interface NativeInputMonitorClass {
  new (callback: (event: GlobalInputEvent) => void): NativeInputMonitorInstance
}

interface NativeInputMonitorInstance {
  start(options?: { mouse?: boolean; keyboard?: boolean; throttleMs?: number }): void
  stop(): void
  isRunning(): boolean
}

interface NativeInputMonitorAddon {
  InputMonitor: NativeInputMonitorClass
}

let cachedAddon: NativeInputMonitorAddon | null | undefined = undefined

type ScreenToDipPoint = (point: { x: number; y: number }) => { x: number; y: number }

function loadAddon(): NativeInputMonitorAddon | null {
  if (cachedAddon !== undefined) return cachedAddon

  const attempts: Array<{ path: string; error: unknown }> = []

  for (const addonPath of getNativeBuildAddonPathCandidates('input_monitor.node')) {
    try {
      cachedAddon = require(addonPath) as NativeInputMonitorAddon
      log.info(`[NativeInputMonitor] 原生模块加载成功: ${addonPath}`)
      return cachedAddon
    } catch (err) {
      attempts.push({ path: addonPath, error: err })
    }
  }

  log.warn('[NativeInputMonitor] 原生模块加载失败，全局输入监听不可用:', attempts)
  cachedAddon = null
  return null
}

export function isInputMonitorAvailable(): boolean {
  return loadAddon() !== null
}

export type InputEventCallback = (event: GlobalInputEvent) => void

export function normalizeInputMonitorEventCoordinates(
  event: GlobalInputEvent,
  options: {
    platform?: NodeJS.Platform
    screenToDipPoint?: ScreenToDipPoint
  } = {}
): GlobalInputEvent {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return event
  if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return event

  const screenToDipPoint = options.screenToDipPoint ?? screen?.screenToDipPoint?.bind(screen)
  if (typeof screenToDipPoint !== 'function') return event

  try {
    const point = screenToDipPoint({ x: event.x, y: event.y })
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return event
    return {
      ...event,
      x: point.x,
      y: point.y
    }
  } catch {
    return event
  }
}

export interface InputMonitorHandle {
  start(): void
  stop(): void
  isRunning(): boolean
  destroy(): void
}

/**
 * 创建输入监听器实例
 *
 * 底层直接创建原生 InputMonitor 实例。
 * 如果需要多插件共享，由上层 PluginInputMonitor 管理引用计数。
 */
export function createInputMonitor(
  callback: InputEventCallback,
  options?: InputMonitorOptions
): InputMonitorHandle | null {
  const addon = loadAddon()
  if (!addon) return null

  const opts = {
    mouse: options?.mouse ?? true,
    keyboard: options?.keyboard ?? true,
    throttleMs: options?.throttleMs ?? 16
  }

  let instance: NativeInputMonitorInstance | null = null

  try {
    instance = new addon.InputMonitor((event) => {
      callback(normalizeInputMonitorEventCoordinates(event))
    })
  } catch (err) {
    log.error('[NativeInputMonitor] 创建实例失败:', err)
    return null
  }

  return {
    start() {
      if (!instance) return
      try {
        instance.start(opts)
      } catch (err) {
        log.error('[NativeInputMonitor] 启动监听失败:', err)
      }
    },
    stop() {
      if (!instance) return
      try {
        instance.stop()
      } catch (err) {
        log.error('[NativeInputMonitor] 停止监听失败:', err)
      }
    },
    isRunning() {
      if (!instance) return false
      try {
        return instance.isRunning()
      } catch {
        return false
      }
    },
    destroy() {
      if (instance) {
        try { instance.stop() } catch { /* ignore */ }
        instance = null
      }
    }
  }
}
