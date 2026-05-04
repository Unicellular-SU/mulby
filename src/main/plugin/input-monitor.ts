/**
 * input-monitor.ts — 插件级全局输入监听管理
 *
 * 设计要点：
 *   - 单个原生监听器实例，多插件共享（引用计数）
 *   - 每个插件独立会话，互不干扰
 *   - 新 session 的 options 会动态合并到共享 monitor，必要时重启
 *   - 插件退出/卸载时自动清理
 *   - 启动前自动检查辅助功能权限 (macOS)
 */

import {
  createInputMonitor,
  isInputMonitorAvailable,
  type GlobalInputEvent,
  type InputMonitorHandle,
  type InputMonitorOptions,
  type InputEventCallback
} from '../services/native-input-monitor'
import { permissionManager } from './permission-manager'
import log from 'electron-log'

interface MonitorSession {
  id: string
  pluginName: string
  callback: InputEventCallback | null
  options: Required<InputMonitorOptions>
}

interface ResolvedMonitorOptions {
  mouse: boolean
  keyboard: boolean
  throttleMs: number
}

let sessionCounter = 0

class PluginInputMonitor {
  private sessions = new Map<string, MonitorSession>()
  private sharedMonitor: InputMonitorHandle | null = null
  private pluginSessions = new Map<string, Set<string>>()
  private currentMonitorOptions: ResolvedMonitorOptions | null = null

  isAvailable(): boolean {
    return isInputMonitorAvailable()
  }

  async requireAccessibility(): Promise<boolean> {
    if (process.platform !== 'darwin') return true
    const status = permissionManager.getStatus('accessibility')
    if (status === 'granted' || status === 'authorized') return true
    const result = await permissionManager.request('accessibility')
    return result === 'granted' || result === 'authorized'
  }

  /**
   * 启动全局输入监听会话。
   *
   * callback 参数仅在同进程调用时有效（如从 IPC handler 传入的闭包）。
   * 后端插件（UtilityProcess）不能传递函数跨进程，应使用 onEvent() 绑定回调。
   */
  async start(
    pluginName: string,
    options?: InputMonitorOptions,
    callback?: InputEventCallback
  ): Promise<string | null> {
    if (!this.isAvailable()) {
      log.warn(`[PluginInputMonitor] ${pluginName}: 原生模块不可用`)
      return null
    }

    const hasAccess = await this.requireAccessibility()
    if (!hasAccess) {
      log.warn(`[PluginInputMonitor] ${pluginName}: 辅助功能权限未授予`)
      return null
    }

    const sessionId = `im_${++sessionCounter}_${Date.now()}`
    const resolvedOptions: Required<InputMonitorOptions> = {
      mouse: options?.mouse ?? true,
      keyboard: options?.keyboard ?? true,
      throttleMs: options?.throttleMs ?? 16
    }

    const session: MonitorSession = {
      id: sessionId,
      pluginName,
      callback: typeof callback === 'function' ? callback : null,
      options: resolvedOptions
    }

    this.sessions.set(sessionId, session)

    if (!this.pluginSessions.has(pluginName)) {
      this.pluginSessions.set(pluginName, new Set())
    }
    this.pluginSessions.get(pluginName)!.add(sessionId)

    this.reconcileMonitor()

    log.info(`[PluginInputMonitor] ${pluginName}: 会话 ${sessionId} 已启动`)
    return sessionId
  }

  stop(pluginName: string, sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.pluginName !== pluginName) return

    this.sessions.delete(sessionId)
    this.pluginSessions.get(pluginName)?.delete(sessionId)

    if (this.sessions.size === 0) {
      this.stopMonitor()
    } else {
      this.reconcileMonitor()
    }

    log.info(`[PluginInputMonitor] ${pluginName}: 会话 ${sessionId} 已停止`)
  }

  onEvent(sessionId: string, callback: InputEventCallback): void {
    const session = this.sessions.get(sessionId)
    if (session && typeof callback === 'function') {
      session.callback = callback
    }
  }

  cleanupPlugin(pluginName: string): void {
    const sessionIds = this.pluginSessions.get(pluginName)
    if (!sessionIds || sessionIds.size === 0) return

    for (const sessionId of sessionIds) {
      this.sessions.delete(sessionId)
    }
    this.pluginSessions.delete(pluginName)

    if (this.sessions.size === 0) {
      this.stopMonitor()
    } else {
      this.reconcileMonitor()
    }

    log.info(`[PluginInputMonitor] ${pluginName}: 所有会话已清理`)
  }

  getActiveSessionCount(): number {
    return this.sessions.size
  }

  /**
   * 重新计算所有活跃 session 需要的合并 options，
   * 如果当前共享 monitor 的 options 不能覆盖需求则重启。
   */
  private reconcileMonitor(): void {
    const needed = this.computeUnionOptions()
    if (!needed.mouse && !needed.keyboard) {
      this.stopMonitor()
      return
    }

    if (
      this.sharedMonitor?.isRunning() &&
      this.currentMonitorOptions &&
      this.optionsCover(this.currentMonitorOptions, needed)
    ) {
      return
    }

    this.stopMonitor()

    this.sharedMonitor = createInputMonitor(
      (event) => this.dispatchEvent(event),
      { mouse: needed.mouse, keyboard: needed.keyboard, throttleMs: needed.throttleMs }
    )

    if (this.sharedMonitor) {
      this.sharedMonitor.start()
      this.currentMonitorOptions = needed
      log.info(`[PluginInputMonitor] 共享监听器已启动 (mouse=${needed.mouse}, keyboard=${needed.keyboard}, throttle=${needed.throttleMs})`)
    }
  }

  private computeUnionOptions(): ResolvedMonitorOptions {
    let needMouse = false
    let needKeyboard = false
    let minThrottle = Infinity

    for (const session of this.sessions.values()) {
      if (session.options.mouse) needMouse = true
      if (session.options.keyboard) needKeyboard = true
      minThrottle = Math.min(minThrottle, session.options.throttleMs)
    }

    return {
      mouse: needMouse,
      keyboard: needKeyboard,
      throttleMs: minThrottle === Infinity ? 16 : minThrottle
    }
  }

  private optionsCover(current: ResolvedMonitorOptions, needed: ResolvedMonitorOptions): boolean {
    if (needed.mouse && !current.mouse) return false
    if (needed.keyboard && !current.keyboard) return false
    if (needed.throttleMs < current.throttleMs) return false
    return true
  }

  private stopMonitor(): void {
    if (this.sharedMonitor) {
      this.sharedMonitor.destroy()
      this.sharedMonitor = null
      this.currentMonitorOptions = null
      log.info('[PluginInputMonitor] 共享监听器已停止')
    }
  }

  private dispatchEvent(event: GlobalInputEvent): void {
    const isMouse = event.type.startsWith('mouse')
    const isKeyboard = event.type.startsWith('key')

    for (const session of this.sessions.values()) {
      if (isMouse && !session.options.mouse) continue
      if (isKeyboard && !session.options.keyboard) continue

      if (!session.callback) continue

      try {
        session.callback(event)
      } catch (err) {
        log.error(`[PluginInputMonitor] ${session.pluginName}: 回调异常:`, err)
      }
    }
  }

  destroy(): void {
    this.sessions.clear()
    this.pluginSessions.clear()
    this.stopMonitor()
  }
}

export const pluginInputMonitor = new PluginInputMonitor()
export type { GlobalInputEvent, InputMonitorOptions, InputEventCallback }
