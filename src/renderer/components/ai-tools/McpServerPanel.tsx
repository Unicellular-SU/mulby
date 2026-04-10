/**
 * MCP Server 设置面板
 *
 * 展示  Mulby 作为 MCP Server 的运行状态、认证 Token、
 * 端口配置、已暴露工具列表、客户端配置示例。
 */
import { useCallback, useEffect, useState } from 'react'

// ===================== 类型 =====================

interface McpServerState {
  status: 'stopped' | 'starting' | 'running' | 'error'
  port: number
  address?: string
  toolCount: number
  error?: string
  startedAt?: number
}

interface McpServerConfig {
  enabled: boolean
  port: number
  token: string
  stdioBridgePath: string
}

interface McpToolEntry {
  name: string
  toolName: string
  pluginName: string
}

interface ClientConfigExample {
  claudeDesktop: object
  cursor: object
  generic: object
}

type ConfigTab = 'claudeDesktop' | 'cursor' | 'stdio' | 'generic'

// ===================== 样式常量 =====================

const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white p-6 dark:border-slate-800/80 dark:bg-slate-900'
const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50'

// ===================== 工具函数 =====================

/** 格式化运行时长 */
function formatUptime(startedAt?: number): string {
  if (!startedAt) return '-'
  const ms = Date.now() - startedAt
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const remainMin = minutes % 60
  return remainMin > 0 ? `${hours} 小时 ${remainMin} 分` : `${hours} 小时`
}

/** 状态颜色 */
function statusColor(status: McpServerState['status']) {
  switch (status) {
    case 'running': return { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', label: '运行中' }
    case 'starting': return { dot: 'bg-amber-400 animate-pulse', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', label: '启动中' }
    case 'error': return { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', label: '错误' }
    default: return { dot: 'bg-slate-300 dark:bg-slate-600', badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', label: '已停止' }
  }
}

// ===================== 子组件 =====================

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 兜底
    }
  }, [text])

  return (
    <button className={actionButtonClass} onClick={handleCopy}>
      {copied ? '已复制 ✓' : label}
    </button>
  )
}

// ===================== 主组件 =====================

export default function McpServerPanel() {
  const [state, setState] = useState<McpServerState | null>(null)
  const [config, setConfig] = useState<McpServerConfig | null>(null)
  const [tools, setTools] = useState<McpToolEntry[]>([])
  const [clientConfig, setClientConfig] = useState<ClientConfigExample | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [portDraft, setPortDraft] = useState('')
  const [portDirty, setPortDirty] = useState(false)
  const [configTab, setConfigTab] = useState<ConfigTab>('claudeDesktop')

  // 加载所有数据
  const refresh = useCallback(async () => {
    const api = window.mulby?.ai?.mcpServer
    if (!api) return
    try {
      const [s, c, t, cc] = await Promise.all([
        api.getState(),
        api.getConfig(),
        api.getTools().catch(() => []),
        api.getClientConfig().catch(() => null)
      ])
      setState(s as McpServerState)
      setConfig(c as McpServerConfig)
      setTools((t || []) as McpToolEntry[])
      setClientConfig(cc as ClientConfigExample | null)
      setPortDraft(String((c as McpServerConfig)?.port || 18790))
      setPortDirty(false)
    } catch (err) {
      console.error('[McpServerPanel] 加载失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 定时刷新状态（运行中时 5s 一次）
  useEffect(() => {
    if (state?.status !== 'running' && state?.status !== 'starting') return
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => clearInterval(timer)
  }, [state?.status, refresh])

  // 启停
  const handleToggle = useCallback(async () => {
    const api = window.mulby?.ai?.mcpServer
    if (!api || !state) return
    setBusy(true)
    try {
      if (state.status === 'running' || state.status === 'starting') {
        await api.stop()
      } else {
        await api.start()
      }
      // 等待一小段时间让服务器状态稳定
      await new Promise(r => setTimeout(r, 500))
      await refresh()
    } catch (err) {
      console.error('[McpServerPanel] 启停失败:', err)
    } finally {
      setBusy(false)
    }
  }, [state, refresh])

  // 重新生成 Token
  const handleRegenerateToken = useCallback(async () => {
    const api = window.mulby?.ai?.mcpServer
    if (!api) return
    setBusy(true)
    try {
      await api.regenerateToken()
      setShowToken(false)
      await refresh()
    } catch (err) {
      console.error('[McpServerPanel] Token 重新生成失败:', err)
    } finally {
      setBusy(false)
    }
  }, [refresh])

  // 更新端口
  const handleSavePort = useCallback(async () => {
    const api = window.mulby?.ai?.mcpServer
    if (!api) return
    const port = Number(portDraft)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return
    setBusy(true)
    try {
      await api.updatePort(port)
      await refresh()
    } catch (err) {
      console.error('[McpServerPanel] 端口更新失败:', err)
    } finally {
      setBusy(false)
    }
  }, [portDraft, refresh])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          加载中...
        </div>
      </div>
    )
  }

  const isRunning = state?.status === 'running'
  const isActive = isRunning || state?.status === 'starting'
  const sc = statusColor(state?.status || 'stopped')

  // 运行中时，配置端口可能和实际运行端口不同（用户修改了端口但未重启）
  const runningPort = state?.port || config?.port || 18790
  const configPort = config?.port || 18790
  const portMismatch = isRunning && configPort !== runningPort

  // 构建 stdio bridge 配置 JSON（使用实际运行端口）
  const stdioBridgeConfig = config ? JSON.stringify({
    mcpServers: {
      mulby: {
        command: 'node',
        args: [config.stdioBridgePath],
        env: {
          MULBY_MCP_URL: `http://127.0.0.1:${runningPort}/mcp`,
          MULBY_MCP_TOKEN: config.token
        }
      }
    }
  }, null, 2) : ''

  // 配置 Tab 定义
  const configTabs: Array<{ id: ConfigTab; label: string }> = [
    { id: 'claudeDesktop', label: 'Claude Desktop' },
    { id: 'cursor', label: 'Cursor' },
    { id: 'stdio', label: 'Stdio Bridge' },
    { id: 'generic', label: '通用' }
  ]

  const currentConfigJson = (() => {
    if (!clientConfig) return '{}'
    switch (configTab) {
      case 'claudeDesktop': return JSON.stringify(clientConfig.claudeDesktop, null, 2)
      case 'cursor': return JSON.stringify(clientConfig.cursor, null, 2)
      case 'stdio': return stdioBridgeConfig
      case 'generic': return JSON.stringify(clientConfig.generic, null, 2)
      default: return '{}'
    }
  })()

  return (
    <div className="space-y-5">
      {/* ==================== 状态卡片 ==================== */}
      <section className={cardClass}>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">MCP Server</div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">将 Mulby 插件工具通过 MCP 协议暴露给外部 AI 工具</div>
          </div>

          {/* 开关 */}
          <button
            type="button"
            disabled={busy}
            className={`relative h-7 w-[52px] rounded-full transition-colors ${isActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'} ${busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            onClick={handleToggle}
            title={isActive ? '点击停止' : '点击启动'}
          >
            <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${isActive ? 'translate-x-[24px]' : ''}`} />
          </button>
        </div>

        {/* 状态信息网格 */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
          <div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">状态</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${sc.dot}`} />
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${sc.badge}`}>{sc.label}</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">端口</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{runningPort}</span>
              {portMismatch && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">待重启 → {configPort}</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">已暴露工具</div>
            <div className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-200">{state?.toolCount || 0} 个</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">运行时长</div>
            <div className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-200">{isRunning ? formatUptime(state?.startedAt) : '-'}</div>
          </div>
        </div>

        {/* 地址显示 */}
        {isRunning && state?.address && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-2 dark:border-slate-800/80 dark:bg-slate-950">
            <code className="flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{state.address}</code>
            <CopyButton text={state.address} />
          </div>
        )}

        {/* 错误信息 */}
        {state?.status === 'error' && state.error && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-600 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-300">
            {state.error}
          </div>
        )}
      </section>

      {/* ==================== 认证 Token ==================== */}
      {config && (
        <section className={cardClass}>
          <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">认证 Token</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800/80 dark:bg-slate-950">
              <code className="text-xs text-slate-600 dark:text-slate-300 select-all">
                {showToken ? config.token : '•'.repeat(Math.min(config.token.length, 36))}
              </code>
            </div>
            <button className={actionButtonClass} onClick={() => setShowToken(!showToken)}>
              {showToken ? '隐藏' : '显示'}
            </button>
            <CopyButton text={config.token} />
            <button
              className={`${actionButtonClass} text-amber-600 hover:text-amber-700 dark:text-amber-400`}
              disabled={busy}
              onClick={handleRegenerateToken}
              title="重新生成 Token（所有客户端需要更新配置）"
            >
              重新生成
            </button>
          </div>
          <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            ⚠️ Token 重新生成后，所有已配置的客户端需要同步更新
          </div>
        </section>
      )}

      {/* ==================== 端口设置 ==================== */}
      {config && (
        <section className={cardClass}>
          <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">端口设置</div>
          <div className="flex items-center gap-3">
            <label className="flex-1 space-y-1">
              <input
                type="number"
                className={inputClass}
                value={portDraft}
                min={1024}
                max={65535}
                onChange={(e) => {
                  setPortDraft(e.target.value)
                  setPortDirty(e.target.value !== String(config.port))
                }}
                placeholder="18790"
              />
            </label>
            {portDirty && (
              <button
                className={actionButtonClass}
                disabled={busy}
                onClick={handleSavePort}
              >
                保存
              </button>
            )}
            {/* 运行中且配置端口和运行端口不一致时，显示重启按钮 */}
            {portMismatch && !portDirty && (
              <button
                className={`${actionButtonClass} text-amber-600 hover:text-amber-700 dark:text-amber-400`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const api = window.mulby?.ai?.mcpServer
                    if (api) {
                      await api.restart()
                      await new Promise(r => setTimeout(r, 500))
                      await refresh()
                    }
                  } catch (err) {
                    console.error('[McpServerPanel] 重启失败:', err)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                重启生效
              </button>
            )}
          </div>
          {portDirty && (
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              ℹ️ 修改端口后需要重启 MCP Server 生效
            </div>
          )}
          {portMismatch && !portDirty && (
            <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
              ⚠️ 端口已修改为 {configPort}，当前仍监听 {runningPort}，点击「重启生效」
            </div>
          )}
        </section>
      )}

      {/* ==================== 已暴露工具列表 ==================== */}
      <section className={cardClass}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">已暴露工具</div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              来自 PluginToolRegistry 中未被禁用的插件工具
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {tools.length} 个
          </span>
        </div>

        {tools.length > 0 ? (
          <div className="divide-y divide-slate-200/50 dark:divide-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 overflow-hidden">
            {tools.map((tool) => (
              <div key={tool.name} className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-slate-950">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {tool.name}
                  </code>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {tool.pluginName}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {isRunning ? '当前无已暴露的工具。请在「插件工具」中启用工具。' : 'MCP Server 未运行。启动后将显示可用工具列表。'}
          </div>
        )}

        <div className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
          💡 在左侧「插件工具」中可以控制哪些工具对 AI 可见
        </div>
      </section>

      {/* ==================== 客户端配置示例 ==================== */}
      {config && clientConfig && (
        <section className={cardClass}>
          <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">客户端配置示例</div>

          {/* Tab 切换 */}
          <div className="mb-3 flex gap-1.5 rounded-2xl border border-slate-200/80 bg-slate-50 p-1 dark:border-slate-800/80 dark:bg-slate-950">
            {configTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`flex-1 rounded-xl px-2 py-1.5 text-xs font-medium transition ${
                  configTab === tab.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
                onClick={() => setConfigTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 代码区域 */}
          <div className="relative rounded-2xl border border-slate-200/80 bg-slate-950 p-4 dark:border-slate-800/80">
            <pre className="overflow-x-auto text-xs leading-relaxed text-emerald-400 font-mono">
              {currentConfigJson}
            </pre>
            <div className="absolute right-3 top-3">
              <CopyButton text={currentConfigJson} label="复制配置" />
            </div>
          </div>

          {/* stdio bridge 路径提示 */}
          {configTab === 'stdio' && config.stdioBridgePath && (
            <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-2.5 dark:border-slate-800/80 dark:bg-slate-950">
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-1">Stdio Bridge 路径</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-[11px] text-slate-600 dark:text-slate-300 select-all">{config.stdioBridgePath}</code>
                <CopyButton text={config.stdioBridgePath} label="复制" />
              </div>
            </div>
          )}

          <div className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
            💡 将以上配置粘贴到对应客户端的 MCP 配置文件中即可使用
          </div>
        </section>
      )}
    </div>
  )
}
