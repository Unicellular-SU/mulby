/**
 * 日志查看器独立视图
 * 参考 SettingsView 样式设计
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import UnifiedSelect from './UnifiedSelect'

// 日志条目接口
interface LogEntry {
    timestamp: number
    level: 'debug' | 'info' | 'warn' | 'error' | 'crash'
    pluginId: string
    message: string
    args?: unknown[]
    crashDetails?: {
        reason: string
        exitCode?: number
        windowId?: number
    }
}

// 日志级别颜色映射
const LEVEL_COLORS: Record<string, { bg: string; text: string }> = {
    debug: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400' },
    info: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-600 dark:text-blue-400' },
    warn: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-600 dark:text-yellow-400' },
    error: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-600 dark:text-red-400' },
    crash: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' }
}

interface LogViewerViewProps {
    onClose: () => void
}

export default function LogViewerView({ onClose }: LogViewerViewProps) {
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [filterLevel, setFilterLevel] = useState<string>('all')
    const [filterPlugin, setFilterPlugin] = useState<string>('all')
    const [searchText, setSearchText] = useState('')
    const [autoScroll, setAutoScroll] = useState(true)
    const [logsDir, setLogsDir] = useState<string>('')

    const logContainerRef = useRef<HTMLDivElement>(null)

    // 加载日志
    const loadLogs = useCallback(async () => {
        try {
            const result = await window.mulby.log.getLogs({ limit: 500 })
            setLogs(result)
        } catch (e) {
            console.error('Failed to load logs:', e)
        } finally {
            setLoading(false)
        }
    }, [])

    // 获取日志目录
    useEffect(() => {
        window.mulby.log.getLogsDir().then(setLogsDir)
    }, [])

    // 初始加载
    useEffect(() => {
        loadLogs()
    }, [loadLogs])

    // 订阅实时日志
    useEffect(() => {
        window.mulby.log.subscribe()
        const cleanup = window.mulby.log.onLog((entry: LogEntry) => {
            setLogs(prev => [...prev.slice(-499), entry])
        })
        return cleanup
    }, [])

    // 自动滚动到底部
    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
        }
    }, [logs, autoScroll])

    // 过滤日志
    const filteredLogs = logs.filter(log => {
        if (filterLevel !== 'all' && log.level !== filterLevel) return false
        if (filterPlugin !== 'all' && log.pluginId !== filterPlugin) return false
        if (searchText && !log.message.toLowerCase().includes(searchText.toLowerCase())) return false
        return true
    })

    // 获取所有插件 ID
    const pluginIds = [...new Set(logs.map(l => l.pluginId))]

    // 清除日志
    const handleClear = async () => {
        await window.mulby.log.clear()
        setLogs([])
    }

    // 打开日志目录
    const handleOpenLogsDir = () => {
        if (logsDir) {
            window.mulby.shell.openFolder(logsDir)
        }
    }

    // 格式化时间戳
    const formatTime = (ts: number) => {
        const date = new Date(ts)
        const timeStr = date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
        const ms = String(date.getMilliseconds()).padStart(3, '0')
        return `${timeStr}.${ms}`
    }

    const pillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white no-drag'
    const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900 no-drag'

    return (
        <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            {/* 背景装饰 */}
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-emerald-200/40 blur-[120px] dark:bg-emerald-500/20" />
                <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-400/10" />
                <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-purple-200/30 blur-[120px] dark:bg-purple-500/10" />
            </div>

            <div className="relative flex h-full min-h-0 flex-col">
                {/* 头部 */}
                <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white/70 px-6 py-4  dark:border-slate-800/80 dark:bg-slate-900/60">
                    <button
                        onClick={onClose}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
                        title="返回"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <div className="flex-1">
                        <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Developer</div>
                        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">日志查看器</div>
                    </div>
                    <div className="flex items-center gap-2 no-drag">
                        <button className={pillClass} onClick={handleOpenLogsDir}>
                            打开日志目录
                        </button>
                        <button className={pillClass} onClick={loadLogs}>
                            刷新
                        </button>
                        <button className={`${pillClass} text-red-500 hover:text-red-600 dark:text-red-400`} onClick={handleClear}>
                            清除
                        </button>
                    </div>
                </div>

                {/* 过滤器 */}
                <div className="flex flex-wrap items-center gap-4 border-b border-slate-200/70 bg-white/50 px-6 py-3 no-drag dark:border-slate-800/80 dark:bg-slate-900/40">
                    {/* 级别过滤 */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">级别:</span>
                        <div className="flex gap-1">
                            {['all', 'debug', 'info', 'warn', 'error', 'crash'].map(level => (
                                <button
                                    key={level}
                                    className={filterLevel === level ? primaryPillClass : pillClass}
                                    onClick={() => setFilterLevel(level)}
                                >
                                    {level === 'all' ? '全部' : level.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 插件过滤 */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">插件:</span>
                        <UnifiedSelect
                            wrapperClassName="w-44 no-drag"
                            className="no-drag"
                            value={filterPlugin}
                            onChange={e => setFilterPlugin(e.target.value)}
                        >
                            <option value="all">全部</option>
                            {pluginIds.map(id => (
                                <option key={id} value={id}>{id}</option>
                            ))}
                        </UnifiedSelect>
                    </div>

                    {/* 搜索 */}
                    <div className="flex-1 min-w-[200px]">
                        <input
                            type="text"
                            className="w-full rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 no-drag"
                            placeholder="搜索日志内容..."
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                        />
                    </div>

                    {/* 自动滚动 */}
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={e => setAutoScroll(e.target.checked)}
                            className="rounded border-slate-300 text-blue-500"
                        />
                        <span className="text-xs text-slate-500 dark:text-slate-400">自动滚动</span>
                    </label>
                </div>

                {/* 日志列表 */}
                <div
                    ref={logContainerRef}
                    className="flex-1 overflow-auto bg-white/30 dark:bg-slate-900/30 no-drag"
                >
                    {loading ? (
                        <div className="flex items-center justify-center h-32 text-slate-500">
                            加载中...
                        </div>
                    ) : filteredLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                            <svg className="w-12 h-12 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span>暂无日志</span>
                            <span className="text-xs">开发者模式下，插件调用 window.mulby.log.* 记录日志</span>
                        </div>
                    ) : (
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-slate-100/95 dark:bg-slate-800/95  border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400 w-24">时间</th>
                                    <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400 w-16">级别</th>
                                    <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400 w-32">插件</th>
                                    <th className="px-4 py-2 text-left font-medium text-slate-500 dark:text-slate-400">内容</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredLogs.map((log, index) => {
                                    const colors = LEVEL_COLORS[log.level] || LEVEL_COLORS.debug
                                    return (
                                        <tr
                                            key={`${log.timestamp}-${index}`}
                                            className={`border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 ${log.level === 'crash' ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}
                                        >
                                            <td className="px-4 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap font-mono">
                                                {formatTime(log.timestamp)}
                                            </td>
                                            <td className="px-4 py-2">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${colors.bg} ${colors.text}`}>
                                                    {log.level.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 text-slate-600 dark:text-slate-300 font-medium truncate max-w-[120px]" title={log.pluginId}>
                                                {log.pluginId}
                                            </td>
                                            <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                                                <div className="font-mono break-all">
                                                    {log.message}
                                                    {log.args && log.args.length > 0 && (
                                                        <span className="text-slate-400 dark:text-slate-500 ml-2">
                                                            {JSON.stringify(log.args)}
                                                        </span>
                                                    )}
                                                    {log.crashDetails && (
                                                        <div className="mt-1 text-red-500 dark:text-red-400">
                                                            Exit Code: {log.crashDetails.exitCode ?? 'N/A'}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* 状态栏 */}
                <div className="flex items-center justify-between border-t border-slate-200/70 bg-white/50 px-6 py-2 text-xs text-slate-500  dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
                    <span>共 {filteredLogs.length} 条日志{filterLevel !== 'all' || filterPlugin !== 'all' || searchText ? ` (已过滤)` : ''}</span>
                    {logsDir && (
                        <span className="truncate max-w-[400px]" title={logsDir}>
                            {logsDir}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}
