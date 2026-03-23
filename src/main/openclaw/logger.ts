/**
 * OpenClaw 日志服务
 *
 * 提供结构化日志记录，支持渲染进程订阅日志流。
 * 日志保留在内存中（有上限），用于 UI 日志窗口展示。
 */

import { EventEmitter } from 'node:events'

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 单条日志 */
export interface LogEntry {
  id: number
  level: LogLevel
  time: number
  tag: string
  message: string
  detail?: string
}

/** 最大保留日志数 */
const MAX_LOG_ENTRIES = 500

class OpenClawLogger extends EventEmitter {
  private entries: LogEntry[] = []
  private nextId = 1

  /** 写入日志 */
  log(level: LogLevel, tag: string, message: string, detail?: string): void {
    const entry: LogEntry = {
      id: this.nextId++,
      level,
      time: Date.now(),
      tag,
      message,
      detail
    }
    this.entries.push(entry)

    // 超过上限时修剪前 1/4
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries = this.entries.slice(Math.floor(MAX_LOG_ENTRIES / 4))
    }

    this.emit('log', entry)
  }

  // 便捷方法
  debug(tag: string, msg: string, detail?: string): void { this.log('debug', tag, msg, detail) }
  info(tag: string, msg: string, detail?: string): void { this.log('info', tag, msg, detail) }
  warn(tag: string, msg: string, detail?: string): void { this.log('warn', tag, msg, detail) }
  error(tag: string, msg: string, detail?: string): void { this.log('error', tag, msg, detail) }

  /** 获取当前所有日志 */
  getAll(): LogEntry[] {
    return [...this.entries]
  }

  /** 清除所有日志 */
  clear(): void {
    this.entries = []
    this.nextId = 1
    this.emit('clear')
  }
}

/** 全局单例 */
export const openclawLogger = new OpenClawLogger()
