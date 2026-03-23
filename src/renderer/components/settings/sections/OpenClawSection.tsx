/**
 * OpenClaw Settings Panel — 设置中心 OpenClaw 面板
 *
 * 包含：
 * - 连接配置（Gateway 地址/端口/Token）
 * - 连接状态指示器 + 连接/断开按钮
 * - Node 配置（显示名称、自动连接）
 * - 安全策略（exec 模式、暴露能力开关）
 * - 最近命令调用日志
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import type { OpenClawSettings } from '../../../../shared/types/settings'
import type { NodeStatusInfo, NodeConnectionStatus } from '../../../../shared/types/openclaw-protocol'

interface OpenClawSettingsPanelProps {
  cardClass: string
  actionButtonClass: string
}

// 连接状态中文映射
const STATUS_LABELS: Record<NodeConnectionStatus, { text: string; color: string; dot: string }> = {
  disconnected: { text: '未连接', color: 'text-slate-400 dark:text-slate-500', dot: 'bg-slate-400' },
  connecting: { text: '连接中…', color: 'text-amber-500', dot: 'bg-amber-500 animate-pulse' },
  pairing: { text: '等待配对…', color: 'text-blue-500', dot: 'bg-blue-500 animate-pulse' },
  connected: { text: '已连接', color: 'text-emerald-500', dot: 'bg-emerald-500' },
  error: { text: '连接错误', color: 'text-red-500', dot: 'bg-red-500' }
}

// 安全模式选项
const EXEC_MODE_OPTIONS = [
  { value: 'deny', label: '拒绝所有', description: '不允许任何远程命令执行' },
  { value: 'allowlist', label: '白名单', description: '仅允许白名单中的命令' },
  { value: 'full', label: '完全允许', description: '允许所有命令执行（需注意安全风险）' }
] as const



/** 日志级别颜色 */
const LOG_LEVEL_STYLE: Record<string, { text: string; bg: string; label: string }> = {
  debug: { text: 'text-slate-400', bg: 'bg-slate-400/20', label: 'DBG' },
  info: { text: 'text-blue-400', bg: 'bg-blue-400/20', label: 'INF' },
  warn: { text: 'text-amber-400', bg: 'bg-amber-400/20', label: 'WRN' },
  error: { text: 'text-red-400', bg: 'bg-red-400/20', label: 'ERR' }
}

interface LogEntry {
  id: number
  level: string
  time: number
  tag: string
  message: string
  detail?: string
}

export default function OpenClawSettingsPanel({ cardClass, actionButtonClass }: OpenClawSettingsPanelProps) {
  const [settings, setSettings] = useState<OpenClawSettings | null>(null)
  const [status, setStatus] = useState<NodeStatusInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(true)
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // 本地缓冲状态：仅在 onBlur 时提交到后端，避免每次键入触发重连
  const [localHost, setLocalHost] = useState('')
  const [localPort, setLocalPort] = useState('')
  const [localToken, setLocalToken] = useState('')
  const [localDisplayName, setLocalDisplayName] = useState('')

  // 加载配置和状态
  useEffect(() => {
    void (async () => {
      const [s, st] = await Promise.all([
        window.mulby.openclaw.getSettings(),
        window.mulby.openclaw.getStatus()
      ])
      const ss = s as OpenClawSettings
      setSettings(ss)
      setStatus(st as NodeStatusInfo)
      // 初始化本地缓冲
      setLocalHost(ss.gateway.host || '')
      setLocalPort(String(ss.gateway.port || 18789))
      setLocalToken(ss.auth.token || '')
      setLocalDisplayName(ss.node.displayName || '')
    })()
  }, [])

  // 监听状态变化
  useEffect(() => {
    const unsub = window.mulby.openclaw.onStatusChanged((s: unknown) => {
      setStatus(s as NodeStatusInfo)
    })
    return unsub
  }, [])



  // 加载 + 订阅日志流
  useEffect(() => {
    void (async () => {
      const existing = await window.mulby.openclaw.getLogs() as LogEntry[]
      setLogs(existing)
    })()

    const unsubLog = window.mulby.openclaw.onLog((entry: unknown) => {
      setLogs(prev => {
        const next = [...prev, entry as LogEntry]
        return next.length > 500 ? next.slice(-400) : next
      })
      // 自动滚动到底部
      requestAnimationFrame(() => {
        logContainerRef.current?.scrollTo({ top: logContainerRef.current.scrollHeight })
      })
    })

    const unsubClear = window.mulby.openclaw.onLogsCleared(() => {
      setLogs([])
    })

    return () => { unsubLog(); unsubClear() }
  }, [])

  const handleClearLogs = useCallback(() => {
    void window.mulby.openclaw.clearLogs()
    setLogs([])
  }, [])

  const updateSetting = useCallback(async (partial: Partial<OpenClawSettings>) => {
    const result = await window.mulby.openclaw.updateSettings(partial)
    setSettings(result as OpenClawSettings)
  }, [])

  const handleConnect = async () => {
    setBusy(true)
    try {
      await window.mulby.openclaw.connect()
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    try {
      await window.mulby.openclaw.disconnect()
    } finally {
      setBusy(false)
    }
  }

  const handleTestConnection = async () => {
    if (!settings) return
    setBusy(true)
    setTestResult(null)
    try {
      const result = await window.mulby.openclaw.testConnection(settings) as { ok: boolean; error?: string }
      setTestResult(result)
    } finally {
      setBusy(false)
    }
  }

  if (!settings) {
    return <div className="flex items-center justify-center py-12 text-sm text-slate-400">加载中…</div>
  }

  const statusInfo = STATUS_LABELS[status?.status || 'disconnected']
  const isConnected = status?.status === 'connected'
  // 正在连接/配对/重连中 — 需要显示"取消连接"
  const isAttempting = status?.status === 'connecting' || status?.status === 'pairing' ||
    (status?.status === 'error' && (status.reconnectAttempt ?? 0) > 0)

  return (
    <div className="space-y-6">
      {/* 总开关 */}
      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">启用 OpenClaw Node</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              将 Mulby 作为 OpenClaw 的能力节点，允许 OpenClaw Agent 远程调用 Mulby 能力
            </div>
          </div>
          <button
            className={`relative h-6 w-11 rounded-full transition-colors ${settings.enabled ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-700'}`}
            onClick={() => updateSetting({ enabled: !settings.enabled })}
          >
            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      {settings.enabled && (
        <>
          {/* 连接状态与配置 */}
          <div className={cardClass}>
            <div className="mb-4 text-sm font-medium text-slate-800 dark:text-slate-100">Gateway 连接</div>

            {/* 状态指示器 */}
            <div className="mb-4 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
              <span className={`h-2.5 w-2.5 rounded-full ${statusInfo.dot}`} />
              <span className={`text-sm font-medium ${statusInfo.color}`}>{statusInfo.text}</span>
              {status?.error && (
                <span className="ml-auto text-xs text-red-400">{status.error}</span>
              )}
              {status?.connectedAt && (
                <span className="ml-auto text-xs text-slate-400">
                  已连接 {Math.floor((Date.now() - status.connectedAt) / 60000)} 分钟
                </span>
              )}
            </div>

            {/* 配对提示 */}
            {status?.status === 'pairing' && (
              <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/30">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  请在 OpenClaw Gateway 所在设备上批准此节点的配对请求。
                </p>
                <p className="mt-1 text-xs text-blue-500 dark:text-blue-400">
                  打开 Gateway 控制台 → Nodes → 批准来自 Mulby 的配对请求。
                  <a
                    href="https://docs.openclaw.ai/nodes"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 underline hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    查看文档 ↗
                  </a>
                </p>
              </div>
            )}

            {/* Gateway 配置表单 */}
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Gateway 地址</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={localHost}
                    onChange={(e) => setLocalHost(e.target.value)}
                    onBlur={() => { if (localHost !== settings.gateway.host) updateSetting({ gateway: { ...settings.gateway, host: localHost } }) }}
                    placeholder="127.0.0.1"
                  />
                </div>
                <div className="w-28">
                  <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">端口</label>
                  <input
                    type="number"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={localPort}
                    onChange={(e) => setLocalPort(e.target.value)}
                    onBlur={() => { const p = Number(localPort) || 18789; if (p !== settings.gateway.port) updateSetting({ gateway: { ...settings.gateway, port: p } }) }}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Token（可选）</label>
                <input
                  type="password"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={localToken}
                  onChange={(e) => setLocalToken(e.target.value)}
                  onBlur={() => { if (localToken !== (settings.auth.token || '')) updateSetting({ auth: { ...settings.auth, token: localToken || undefined } }) }}
                  placeholder="Gateway token"
                />
              </div>

              {/* TLS 开关 */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="openclaw-tls"
                  className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                  checked={settings.gateway.useTls}
                  onChange={(e) => updateSetting({ gateway: { ...settings.gateway, useTls: e.target.checked } })}
                />
                <label htmlFor="openclaw-tls" className="text-xs text-slate-600 dark:text-slate-300">使用 TLS 加密连接</label>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-2 pt-2">
                {isConnected ? (
                  <button className={actionButtonClass} onClick={handleDisconnect} disabled={busy}>
                    {busy ? '断开中…' : '断开连接'}
                  </button>
                ) : isAttempting ? (
                  <>
                    <button
                      className={actionButtonClass}
                      onClick={handleDisconnect}
                      disabled={busy}
                    >
                      取消连接
                    </button>
                    {(status?.reconnectAttempt ?? 0) > 0 && (
                      <span className="text-xs text-amber-500">
                        第 {status?.reconnectAttempt} 次重连中…
                      </span>
                    )}
                  </>
                ) : (
                  <button className={actionButtonClass} onClick={handleConnect} disabled={busy}>
                    {busy ? '连接中…' : '连接'}
                  </button>
                )}
                <button className={actionButtonClass} onClick={handleTestConnection} disabled={busy}>
                  {busy ? '测试中…' : '测试连通性'}
                </button>
                {testResult && (
                  <span className={`self-center text-xs ${testResult.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                    {testResult.ok ? '✓ 连通' : `✗ ${testResult.error || '不可达'}`}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Node 配置 */}
          <div className={cardClass}>
            <div className="mb-4 text-sm font-medium text-slate-800 dark:text-slate-100">Node 配置</div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">节点显示名称</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={localDisplayName}
                  onChange={(e) => setLocalDisplayName(e.target.value)}
                  onBlur={() => { if (localDisplayName !== settings.node.displayName) updateSetting({ node: { ...settings.node, displayName: localDisplayName } }) }}
                  placeholder="Mulby"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="openclaw-autoconnect"
                  className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                  checked={settings.node.autoConnect}
                  onChange={(e) => updateSetting({ node: { ...settings.node, autoConnect: e.target.checked } })}
                />
                <label htmlFor="openclaw-autoconnect" className="text-xs text-slate-600 dark:text-slate-300">启动时自动连接</label>
              </div>
            </div>
          </div>

          {/* 安全策略 */}
          <div className={cardClass}>
            <div className="mb-4 text-sm font-medium text-slate-800 dark:text-slate-100">安全策略</div>
            <div className="space-y-4">
              {/* Exec Mode */}
              <div>
                <label className="mb-2 block text-xs text-slate-500 dark:text-slate-400">命令执行策略</label>
                <div className="space-y-2">
                  {EXEC_MODE_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <input
                        type="radio"
                        name="execMode"
                        value={opt.value}
                        checked={settings.security.execMode === opt.value}
                        onChange={() => updateSetting({ security: { ...settings.security, execMode: opt.value } })}
                        className="mt-0.5 h-4 w-4 border-slate-300 text-blue-500 focus:ring-blue-400"
                      />
                      <div>
                        <div className="text-sm text-slate-800 dark:text-slate-100">{opt.label}</div>
                        <div className="text-xs text-slate-400">{opt.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* 暴露能力开关 */}
              <div className="space-y-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">暴露的能力</div>
                {[
                  { key: 'exposePlugins' as const, label: '插件调用', desc: '允许远程调用 Mulby 插件' },
                  { key: 'exposeSearch' as const, label: '搜索', desc: '允许远程搜索' },
                  { key: 'exposeClipboard' as const, label: '剪贴板', desc: '允许远程读写剪贴板' }
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-700 dark:text-slate-200">{item.label}</div>
                      <div className="text-xs text-slate-400">{item.desc}</div>
                    </div>
                    <button
                      className={`relative h-5 w-9 rounded-full transition-colors ${(settings.security[item.key]) ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                      onClick={() => updateSetting({ security: { ...settings.security, [item.key]: !settings.security[item.key] } })}
                    >
                      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${(settings.security[item.key]) ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

           {/* 日志面板 */}
          <div className={cardClass}>
            <div className="mb-3 flex items-center justify-between">
              <button
                className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100"
                onClick={() => setShowLogs(!showLogs)}
              >
                <span className={`inline-block transition-transform ${showLogs ? 'rotate-90' : ''}`}>▶</span>
                调试日志
                <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-normal text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                  {logs.length}
                </span>
              </button>
              {showLogs && logs.length > 0 && (
                <button
                  className="text-xs text-slate-400 hover:text-red-400 transition-colors"
                  onClick={handleClearLogs}
                >
                  清空
                </button>
              )}
            </div>
            {showLogs && (
              <div
                ref={logContainerRef}
                className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-2 font-mono text-[11px] leading-relaxed"
              >
                {logs.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-600">暂无日志</div>
                ) : (
                  logs.map((entry) => {
                    const style = LOG_LEVEL_STYLE[entry.level] || LOG_LEVEL_STYLE.info
                    return (
                      <div
                        key={entry.id}
                        className="flex items-start gap-1.5 py-0.5 hover:bg-slate-900/50 rounded cursor-pointer px-1"
                        onClick={() => entry.detail && setExpandedLogId(expandedLogId === entry.id ? null : entry.id)}
                      >
                        <span className="shrink-0 text-slate-600">
                          {new Date(entry.time).toLocaleTimeString('en', { hour12: false })}
                        </span>
                        <span className={`shrink-0 rounded px-1 ${style.bg} ${style.text}`}>
                          {style.label}
                        </span>
                        <span className="shrink-0 text-cyan-400/70">[{entry.tag}]</span>
                        <span className="min-w-0 break-all text-slate-200">
                          {entry.message}
                          {expandedLogId === entry.id && entry.detail && (
                            <div className="mt-0.5 whitespace-pre-wrap text-slate-500">{entry.detail}</div>
                          )}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
