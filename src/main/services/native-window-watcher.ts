import log from 'electron-log'
import { getNativeBuildAddonPathCandidates } from './native-addon-path'

interface WindowWatcherAddon {
  WindowWatcher: {
    new (callback: (info: { app: string; bundleId?: string; pid: number; type?: string }) => void): WindowWatcherInstance
  }
}

interface WindowWatcherInstance {
  start(): void
  stop(): void
}

let watcherInstance: WindowWatcherInstance | null = null

export interface NativeWindowChangeEvent {
  app: string
  bundleId?: string
  pid: number
  /** 事件类型: "focus" 窗口焦点切换 | "title" 标题变化 | "activate" 应用激活 */
  type?: 'focus' | 'title' | 'activate'
}

// 事件分发器
type WatcherCallback = (info: NativeWindowChangeEvent) => void
const callbacks = new Set<WatcherCallback>()

/**
 * 启动并注册原生窗口监听回调
 * @param callback 窗口变更时的回调
 * @returns 取消订阅的函数
 */
export function subscribeNativeWindowChange(callback: WatcherCallback): () => void {
  callbacks.add(callback)

  if (!watcherInstance && process.platform === 'darwin') {
    try {
      let addon: WindowWatcherAddon | null = null
      const attempts: Array<{ path: string; error: unknown }> = []

      for (const addonPath of getNativeBuildAddonPathCandidates('window_watcher.node')) {
        try {
          addon = require(addonPath) as WindowWatcherAddon
          log.info(`[WindowWatcher] Native addon loaded successfully from: ${addonPath}`)
          break
        } catch (err) {
          attempts.push({ path: addonPath, error: err })
        }
      }

      if (!addon) {
        throw attempts
      }

      watcherInstance = new addon.WindowWatcher((info) => {
        // 窄化 type 字段
        const event: NativeWindowChangeEvent = {
          app: info.app,
          bundleId: info.bundleId,
          pid: info.pid,
          type: (info.type === 'title' || info.type === 'activate') ? info.type : 'focus'
        }
        // 触发所有回调
        for (const cb of callbacks) {
          try {
            cb(event)
          } catch (e) {
            log.error('[WindowWatcher] Callback error:', e)
          }
        }
      })
      watcherInstance.start()
    } catch (err) {
      log.warn('[WindowWatcher] Failed to load native addon:', err)
      throw err
    }
  }

  return () => {
    callbacks.delete(callback)
    if (callbacks.size === 0 && watcherInstance) {
      watcherInstance.stop()
      watcherInstance = null
    }
  }
}

/**
 * 暴露给外部用于触发模拟测试或 Windows/Linux 回退触发的机制
 * (如果使用长轮询或 Koffi hook 也可以从这里触发给所有关注 window-change 的订阅者)
 */
export function emitNativeWindowChange(info: NativeWindowChangeEvent): void {
  for (const cb of callbacks) {
    try {
      cb(info)
    } catch (e) {
      log.error('[WindowWatcher] Callback emit error:', e)
    }
  }
}
