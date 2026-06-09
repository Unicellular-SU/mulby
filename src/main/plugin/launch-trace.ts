/**
 * Staged launch profiler (P5)
 *
 * 复用贯穿启动链路的 launchStart 时间戳，记录冷/热启动各阶段相对耗时
 * （host-init / onload / attach / restore 等），便于用数据定位真实瓶颈，
 * 而不是凭感觉调常量。纯聚合/格式化逻辑独立成函数以便单测。
 */

import log from 'electron-log'

export interface LaunchPhaseMark {
  phase: string
  /** 相对 launchStart 的耗时（毫秒） */
  at: number
}

interface LaunchTraceState {
  pluginId: string
  t0: number
  marks: LaunchPhaseMark[]
}

const traces = new Map<number, LaunchTraceState>()

/** 是否启用启动埋点。默认仅在显式开启时输出，避免污染正常日志。 */
function isEnabled(): boolean {
  return process.env.MULBY_LAUNCH_PROFILE === '1' || process.env.MULBY_LAUNCH_PROFILE === 'true'
}

export function startLaunchTrace(launchId: number | undefined, pluginId: string): void {
  if (!isEnabled() || !launchId) return
  traces.set(launchId, { pluginId, t0: launchId, marks: [] })
}

export function markLaunchPhase(launchId: number | undefined, phase: string, now: number = Date.now()): void {
  if (!isEnabled() || !launchId) return
  const state = traces.get(launchId)
  if (!state) return
  state.marks.push({ phase, at: Math.max(0, now - state.t0) })
}

/**
 * 纯函数：把阶段标记格式化为单行摘要，便于单测。
 * 例：`[LaunchProfile] plugin=foo total=120ms | host-init:+40ms onload:+70ms attached:+120ms`
 */
export function formatLaunchSummary(pluginId: string, marks: LaunchPhaseMark[]): string {
  const total = marks.length > 0 ? marks[marks.length - 1].at : 0
  const detail = marks.map((m) => `${m.phase}:+${m.at}ms`).join(' ')
  return `[LaunchProfile] plugin=${pluginId} total=${total}ms | ${detail}`.trimEnd()
}

export function flushLaunchTrace(launchId: number | undefined): string | null {
  if (!isEnabled() || !launchId) return null
  const state = traces.get(launchId)
  if (!state) return null
  traces.delete(launchId)
  if (state.marks.length === 0) return null
  const summary = formatLaunchSummary(state.pluginId, state.marks)
  log.info(summary)
  return summary
}
