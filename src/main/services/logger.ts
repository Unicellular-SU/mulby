/**
 * 插件日志服务
 * 基于 electron-log 封装的统一日志系统
 */
import log from 'electron-log'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'

// 日志条目接口
export interface LogEntry {
    timestamp: number
    level: 'debug' | 'info' | 'warn' | 'error' | 'crash'
    pluginId: string
    message: string
    args?: unknown[]
    // 崩溃专用字段
    crashDetails?: {
        reason: string
        exitCode?: number
        windowId?: number
    }
}

type ConfigurableLogLevel = Exclude<LogEntry['level'], 'crash'>

const LOG_LEVEL_PRIORITY: Record<ConfigurableLogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
}

let minLogLevel: ConfigurableLogLevel = 'debug'

// 最近日志的内存缓存（用于崩溃时快速获取）
const recentLogs: LogEntry[] = []
const MAX_RECENT_LOGS = 200

// 日志订阅者
const subscribers: Set<(entry: LogEntry) => void> = new Set()

// 配置日志目录
const logsDir = join(app.getPath('userData'), 'logs')
if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
}

// 配置 electron-log
log.transports.file.resolvePathFn = () => {
    const date = new Date().toISOString().split('T')[0]
    return join(logsDir, `plugin-${date}.log`)
}
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
log.transports.file.maxSize = 10 * 1024 * 1024 // 10MB
log.transports.console.level = 'debug'
log.transports.file.level = 'debug'

function shouldLog(level: LogEntry['level']): boolean {
    if (level === 'crash') return true
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLogLevel]
}

/**
 * 格式化日志条目为字符串
 */
function formatLogEntry(entry: LogEntry): string {
    const parts = [`[${entry.pluginId}]`, entry.message]
    if (entry.args && entry.args.length > 0) {
        try {
            parts.push(JSON.stringify(entry.args))
        } catch {
            parts.push(String(entry.args))
        }
    }
    if (entry.crashDetails) {
        parts.push(`(crash: ${entry.crashDetails.reason})`)
    }
    return parts.join(' ')
}

/**
 * 添加日志到内存缓存
 */
function addToRecent(entry: LogEntry) {
    recentLogs.push(entry)
    if (recentLogs.length > MAX_RECENT_LOGS) {
        recentLogs.shift()
    }
}

/**
 * 通知所有订阅者
 */
function notifySubscribers(entry: LogEntry) {
    subscribers.forEach(callback => {
        try {
            callback(entry)
        } catch (e) {
            console.error('[LoggerService] Subscriber error:', e)
        }
    })
}

/**
 * 日志服务
 */
export const loggerService = {
    /**
     * 写入日志
     */
    write(
        level: LogEntry['level'],
        pluginId: string,
        message: string,
        args?: unknown[]
    ) {
        if (!shouldLog(level)) {
            return
        }

        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            pluginId,
            message,
            args
        }

        // 添加到内存缓存
        addToRecent(entry)

        // 写入日志文件
        const formattedMessage = formatLogEntry(entry)
        switch (level) {
            case 'debug':
                log.debug(formattedMessage)
                break
            case 'info':
                log.info(formattedMessage)
                break
            case 'warn':
                log.warn(formattedMessage)
                break
            case 'error':
            case 'crash':
                log.error(formattedMessage)
                break
        }

        // 通知订阅者（用于实时日志查看）
        notifySubscribers(entry)
    },

    /**
     * 记录崩溃日志
     */
    crash(data: {
        pluginId: string
        reason: string
        exitCode?: number
        windowId?: number
    }) {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level: 'crash',
            pluginId: data.pluginId,
            message: `Render process crashed: ${data.reason}`,
            crashDetails: {
                reason: data.reason,
                exitCode: data.exitCode,
                windowId: data.windowId
            }
        }

        // 添加到内存缓存
        addToRecent(entry)

        // 获取该插件最近的日志作为上下文
        const recentPluginLogs = this.getRecentLogs(data.pluginId, 20)

        // 写入详细的崩溃报告
        const crashReport = [
            '========== PLUGIN CRASH REPORT ==========',
            `Plugin: ${data.pluginId}`,
            `Time: ${new Date().toISOString()}`,
            `Reason: ${data.reason}`,
            `Exit Code: ${data.exitCode ?? 'N/A'}`,
            `Window ID: ${data.windowId ?? 'N/A'}`,
            '--- Recent Logs ---',
            ...recentPluginLogs.map(l =>
                `[${new Date(l.timestamp).toISOString()}] [${l.level}] ${l.message}`
            ),
            '=========================================='
        ].join('\n')

        log.error(crashReport)

        // 通知订阅者
        notifySubscribers(entry)
    },

    /**
     * 获取最近的日志
     */
    getRecentLogs(pluginId?: string, limit = 100): LogEntry[] {
        let logs = pluginId
            ? recentLogs.filter(l => l.pluginId === pluginId)
            : [...recentLogs]

        return logs.slice(-limit)
    },

    /**
     * 从文件读取历史日志
     */
    async getLogs(options?: {
        pluginId?: string
        level?: LogEntry['level']
        limit?: number
        startDate?: Date
        endDate?: Date
    }): Promise<LogEntry[]> {
        const { pluginId, level, limit = 500, startDate, endDate } = options || {}

        // 首先返回内存中的日志
        let logs = this.getRecentLogs(pluginId, limit)

        // 按条件过滤
        if (level) {
            logs = logs.filter(l => l.level === level)
        }
        if (startDate) {
            const startTs = startDate.getTime()
            logs = logs.filter(l => l.timestamp >= startTs)
        }
        if (endDate) {
            const endTs = endDate.getTime()
            logs = logs.filter(l => l.timestamp <= endTs)
        }

        return logs.slice(-limit)
    },

    /**
     * 清除日志
     */
    async clear(pluginId?: string) {
        if (pluginId) {
            // 只清除特定插件的内存日志
            const indicesToRemove: number[] = []
            recentLogs.forEach((log, index) => {
                if (log.pluginId === pluginId) {
                    indicesToRemove.push(index)
                }
            })
            // 从后往前删除
            for (let i = indicesToRemove.length - 1; i >= 0; i--) {
                recentLogs.splice(indicesToRemove[i], 1)
            }
        } else {
            // 清除所有内存日志
            recentLogs.length = 0
        }
    },

    /**
     * 清理旧日志文件（保留最近7天）
     */
    cleanOldLogs(daysToKeep = 7) {
        const now = Date.now()
        const maxAge = daysToKeep * 24 * 60 * 60 * 1000

        try {
            const files = readdirSync(logsDir)
            for (const file of files) {
                if (!file.startsWith('plugin-') || !file.endsWith('.log')) continue

                const filePath = join(logsDir, file)
                const stats = statSync(filePath)
                const age = now - stats.mtime.getTime()

                if (age > maxAge) {
                    unlinkSync(filePath)
                    console.log(`[LoggerService] Deleted old log file: ${file}`)
                }
            }
        } catch (e) {
            console.error('[LoggerService] Failed to clean old logs:', e)
        }
    },

    /**
     * 订阅实时日志
     */
    subscribe(callback: (entry: LogEntry) => void): () => void {
        subscribers.add(callback)
        return () => subscribers.delete(callback)
    },

    /**
     * 广播日志到指定窗口
     */
    broadcastTo(window: BrowserWindow, entry: LogEntry) {
        if (!window.isDestroyed()) {
            window.webContents.send('log:new', entry)
        }
    },

    /**
     * 获取日志目录路径
     */
    getLogsDir(): string {
        return logsDir
    }
}

export function setLoggerMinLevel(level: ConfigurableLogLevel | undefined): void {
    const next: ConfigurableLogLevel = level && level in LOG_LEVEL_PRIORITY ? level : 'debug'
    minLogLevel = next
    log.transports.console.level = next
    log.transports.file.level = next
}

// 应用启动时清理旧日志
app.whenReady().then(() => {
    loggerService.cleanOldLogs()
})
