import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiMcpServer, AiMcpTool, AiMcpServerLogEntry } from '../../shared/types/ai'
import UnifiedSelect from './UnifiedSelect'

interface AiMcpSettingsViewProps {
  onBack: () => void
}

const SERVER_TYPE_OPTIONS: Array<{ value: AiMcpServer['type']; label: string }> = [
  { value: 'stdio', label: 'Stdio (本地进程)' },
  { value: 'streamableHttp', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE (兼容)' }
]

const JSON_IMPORT_PLACEHOLDER = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/workspace"]
    }
  }
}`

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  return out.length > 0 ? out : undefined
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined
  const out: Record<string, string> = {}
  Object.entries(value).forEach(([key, item]) => {
    const nextKey = String(key || '').trim()
    if (!nextKey) return
    out[nextKey] = String(item ?? '')
  })
  return Object.keys(out).length > 0 ? out : undefined
}

function inferServerType(rawType: unknown, baseUrl?: string): AiMcpServer['type'] {
  const type = typeof rawType === 'string' ? rawType.trim() : ''
  if (type === 'stdio' || type === 'sse' || type === 'streamableHttp') return type
  if (type.toLowerCase().includes('http')) return 'streamableHttp'
  if (baseUrl && baseUrl.trim()) {
    return baseUrl.trim().endsWith('/mcp') ? 'streamableHttp' : 'sse'
  }
  return 'stdio'
}

function parseTimeoutSec(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed)
    }
  }
  return undefined
}

function normalizeImportedServer(
  alias: string,
  config: unknown,
  existingServers: AiMcpServer[]
): AiMcpServer {
  if (!isPlainObject(config)) {
    throw new Error('JSON 中的服务器配置必须是对象')
  }

  const now = Date.now()
  const id = String((typeof config.id === 'string' ? config.id : alias) || '').trim()
  const name = String((typeof config.name === 'string' ? config.name : alias) || '').trim() || id
  const baseUrl = String((typeof config.baseUrl === 'string' ? config.baseUrl : config.url) || '').trim() || undefined
  const type = inferServerType(config.type, baseUrl)

  if (!id) {
    throw new Error('服务器 ID 不能为空')
  }
  if (existingServers.some((server) => server.id === id)) {
    throw new Error(`服务器 ID 已存在：${id}`)
  }
  if (existingServers.some((server) => server.name === name)) {
    throw new Error(`服务器名称已存在：${name}`)
  }

  const next: AiMcpServer = {
    id,
    name,
    type,
    isActive: false,
    description: typeof config.description === 'string' ? config.description : undefined,
    baseUrl,
    command: typeof config.command === 'string' ? String(config.command).trim() || undefined : undefined,
    args: parseStringArray(config.args),
    env: parseStringRecord(config.env),
    headers: parseStringRecord(config.headers),
    timeoutSec: parseTimeoutSec(config.timeoutSec ?? config.timeout),
    longRunning: config.longRunning === true,
    disabledTools: parseStringArray(config.disabledTools),
    disabledAutoApproveTools: parseStringArray(config.disabledAutoApproveTools),
    installSource: 'manual',
    isTrusted: true,
    installedAt: now,
    trustedAt: now
  }

  if (next.type === 'stdio' && !next.command) {
    throw new Error('JSON 导入失败：stdio 服务器必须提供 command')
  }
  if ((next.type === 'sse' || next.type === 'streamableHttp') && !next.baseUrl) {
    throw new Error(`JSON 导入失败：${next.type} 服务器必须提供 url 或 baseUrl`)
  }
  return next
}

function parseServerFromJson(jsonText: string, existingServers: AiMcpServer[]): AiMcpServer {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('JSON 格式不正确，请检查逗号与引号')
  }

  if (!isPlainObject(parsed)) {
    throw new Error('JSON 顶层必须是对象')
  }

  if (isPlainObject(parsed.mcpServers)) {
    const entries = Object.entries(parsed.mcpServers)
    if (entries.length === 0) {
      throw new Error('mcpServers 不能为空')
    }
    if (entries.length > 1) {
      throw new Error('一次仅支持导入 1 个服务器，请分次导入')
    }
    const [alias, config] = entries[0]
    return normalizeImportedServer(alias, config, existingServers)
  }

  const aliasFromObject = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : `mcp-${Date.now().toString(36)}`
  return normalizeImportedServer(aliasFromObject, parsed, existingServers)
}

function needsProtocolTrustConfirmation(server: AiMcpServer | null): boolean {
  if (!server) return false
  return server.installSource === 'protocol' && server.isTrusted !== true
}

function buildServerCommandPreview(server: AiMcpServer): string {
  if (server.type === 'stdio') {
    const parts = [server.command, ...(server.args || [])]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : '(未配置 command)'
  }
  const endpoint = String(server.baseUrl || '').trim() || '(未配置 baseUrl)'
  return `${server.type} ${endpoint}`
}

function createNewServer(): AiMcpServer {
  const id = `mcp-${Date.now().toString(36)}`
  return {
    id,
    name: id,
    type: 'stdio',
    isActive: false,
    installSource: 'manual',
    isTrusted: true,
    installedAt: Date.now(),
    trustedAt: Date.now(),
    timeoutSec: 60,
    longRunning: false,
    command: '',
    args: []
  }
}

function parseLinesToList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseKeyValueLines(value: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const index = line.indexOf('=')
      if (index <= 0) return
      const key = line.slice(0, index).trim()
      const val = line.slice(index + 1).trim()
      if (!key) return
      out[key] = val
    })
  return Object.keys(out).length > 0 ? out : undefined
}

function toKeyValueLines(input?: Record<string, string>): string {
  if (!input) return ''
  return Object.entries(input)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'} ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      }`}
      onClick={onChange}
    >
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export default function AiMcpSettingsView({ onBack }: AiMcpSettingsViewProps) {
  const [servers, setServers] = useState<AiMcpServer[]>([])
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [draftServer, setDraftServer] = useState<AiMcpServer | null>(null)
  const [draftArgsText, setDraftArgsText] = useState('')
  const [draftEnvText, setDraftEnvText] = useState('')
  const [draftHeadersText, setDraftHeadersText] = useState('')
  const [tools, setTools] = useState<AiMcpTool[]>([])
  const [logs, setLogs] = useState<AiMcpServerLogEntry[]>([])
  const [loadingServers, setLoadingServers] = useState(false)
  const [loadingTools, setLoadingTools] = useState(false)
  const [operationBusy, setOperationBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [jsonImportOpen, setJsonImportOpen] = useState(false)
  const [jsonImportText, setJsonImportText] = useState('')
  const [jsonImportError, setJsonImportError] = useState<string | null>(null)
  const [trustConfirmServer, setTrustConfirmServer] = useState<AiMcpServer | null>(null)
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(new Set())
  const [overflowToolIds, setOverflowToolIds] = useState<Set<string>>(new Set())
  const toolDescriptionRefs = useRef<Record<string, HTMLSpanElement | null>>({})

  const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white p-6 dark:border-slate-800/80 dark:bg-slate-900'
  const cardClassTight = 'rounded-[20px] border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900'
  const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
  const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900'

  const selectedServer = useMemo(
    () => (selectedServerId ? servers.find((server) => server.id === selectedServerId) || null : null),
    [selectedServerId, servers]
  )

  const isNewDraft = !!draftServer && !servers.some((server) => server.id === draftServer.id)

  const loadServers = async () => {
    if (!window.intools?.ai?.mcp?.listServers) {
      setError('MCP API 未就绪，请重启应用')
      return
    }
    setLoadingServers(true)
    try {
      const list = await window.intools.ai.mcp.listServers()
      setServers(list)
      setError(null)
      if (list.length === 0) {
        setSelectedServerId(null)
        setDraftServer(null)
      } else if (!selectedServerId || !list.some((item) => item.id === selectedServerId)) {
        setSelectedServerId(list[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 MCP 服务器失败')
    } finally {
      setLoadingServers(false)
    }
  }

  const loadToolsAndLogs = async (server: AiMcpServer) => {
    if (!window.intools?.ai?.mcp) return

    setLoadingTools(true)
    try {
      if (server.isActive) {
        const list = await window.intools.ai.mcp.listTools(server.id)
        setTools(list)
      } else {
        setTools([])
      }
    } catch (err) {
      setTools([])
      setError(err instanceof Error ? err.message : '加载 MCP 工具失败')
    } finally {
      setLoadingTools(false)
    }

    try {
      const rows = await window.intools.ai.mcp.getLogs(server.id)
      setLogs(rows)
    } catch {
      setLogs([])
    }
  }

  useEffect(() => {
    void loadServers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedServer) return
    setDraftServer({ ...selectedServer })
    setDraftArgsText((selectedServer.args || []).join('\n'))
    setDraftEnvText(toKeyValueLines(selectedServer.env))
    setDraftHeadersText(toKeyValueLines(selectedServer.headers))
    void loadToolsAndLogs(selectedServer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServerId, selectedServer?.id])

  const handleCreateServer = () => {
    const next = createNewServer()
    setDraftServer(next)
    setDraftArgsText('')
    setDraftEnvText('')
    setDraftHeadersText('')
    setSelectedServerId(next.id)
    setInfo('已创建草稿服务器，请填写参数后保存')
    setError(null)
  }

  const handleOpenJsonImport = () => {
    setJsonImportOpen(true)
    setJsonImportError(null)
    setJsonImportText('')
  }

  const handleImportJsonServer = async () => {
    if (!window.intools?.ai?.mcp?.upsertServer) return
    if (!jsonImportText.trim()) {
      setJsonImportError('请先粘贴 MCP JSON 配置')
      return
    }

    let parsedServer: AiMcpServer
    try {
      parsedServer = parseServerFromJson(jsonImportText, servers)
    } catch (err) {
      setJsonImportError(err instanceof Error ? err.message : 'JSON 导入失败')
      return
    }

    setOperationBusy(true)
    try {
      const saved = await window.intools.ai.mcp.upsertServer(parsedServer)
      await loadServers()
      setSelectedServerId(saved.id)
      setJsonImportOpen(false)
      setJsonImportError(null)
      setError(null)
      setInfo(`已从 JSON 导入服务器：${saved.name}`)
    } catch (err) {
      setJsonImportError(err instanceof Error ? err.message : '写入 MCP 配置失败')
    } finally {
      setOperationBusy(false)
    }
  }

  const validateDraftServer = (server: AiMcpServer) => {
    if (!server.id.trim()) return '服务器 ID 不能为空'
    if (!server.name.trim()) return '服务器名称不能为空'
    if (server.type === 'stdio' && !String(server.command || '').trim()) {
      return 'Stdio 模式必须填写 command'
    }
    if ((server.type === 'sse' || server.type === 'streamableHttp') && !String(server.baseUrl || '').trim()) {
      return 'HTTP 模式必须填写 baseUrl'
    }
    return null
  }

  const handleSaveServer = async () => {
    if (!draftServer || !window.intools?.ai?.mcp?.upsertServer) return

    const prepared: AiMcpServer = {
      ...draftServer,
      args: parseLinesToList(draftArgsText),
      env: parseKeyValueLines(draftEnvText),
      headers: parseKeyValueLines(draftHeadersText)
    }

    const invalidMessage = validateDraftServer(prepared)
    if (invalidMessage) {
      setError(invalidMessage)
      return
    }

    setOperationBusy(true)
    try {
      const saved = await window.intools.ai.mcp.upsertServer(prepared)
      await loadServers()
      setSelectedServerId(saved.id)
      setInfo('服务器配置已保存')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 MCP 服务器失败')
    } finally {
      setOperationBusy(false)
    }
  }

  const handleDeleteServer = async () => {
    if (!draftServer || !window.intools?.ai?.mcp?.removeServer) return
    setOperationBusy(true)
    try {
      await window.intools.ai.mcp.removeServer(draftServer.id)
      await loadServers()
      setInfo('服务器已删除')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除 MCP 服务器失败')
    } finally {
      setOperationBusy(false)
    }
  }

  const handleSetActive = async (active: boolean) => {
    if (!draftServer || !window.intools?.ai?.mcp) return
    if (isNewDraft) {
      setError('请先保存服务器，再执行启停操作')
      return
    }

    if (active && needsProtocolTrustConfirmation(draftServer)) {
      setTrustConfirmServer(draftServer)
      setError(null)
      return
    }

    setOperationBusy(true)
    try {
      const next = active
        ? await window.intools.ai.mcp.activateServer(draftServer.id)
        : await window.intools.ai.mcp.deactivateServer(draftServer.id)
      await loadServers()
      setDraftServer({ ...next })
      setSelectedServerId(next.id)
      setInfo(active ? '服务器已启动' : '服务器已停止')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '服务器启停失败')
    } finally {
      setOperationBusy(false)
    }
  }

  const handleTrustConfirmAndActivate = async () => {
    if (!trustConfirmServer || !window.intools?.ai?.mcp) return
    setOperationBusy(true)
    try {
      const trustedServer = await window.intools.ai.mcp.upsertServer({
        ...trustConfirmServer,
        isTrusted: true,
        trustedAt: Date.now()
      })
      const next = await window.intools.ai.mcp.activateServer(trustedServer.id)
      await loadServers()
      setDraftServer({ ...next })
      setSelectedServerId(next.id)
      setTrustConfirmServer(null)
      setInfo('已信任并启动协议安装的 MCP 服务器')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '服务器启停失败')
    } finally {
      setOperationBusy(false)
    }
  }

  const handleRestart = async () => {
    if (!draftServer || !window.intools?.ai?.mcp?.restartServer) return
    if (isNewDraft) {
      setError('请先保存服务器，再执行重启操作')
      return
    }
    setOperationBusy(true)
    try {
      const next = await window.intools.ai.mcp.restartServer(draftServer.id)
      await loadServers()
      setSelectedServerId(next.id)
      setInfo('服务器已重启')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '重启失败')
    } finally {
      setOperationBusy(false)
    }
  }

  const handleConnectivityCheck = async () => {
    if (!draftServer || !window.intools?.ai?.mcp?.checkServer) return
    setOperationBusy(true)
    try {
      const result = await window.intools.ai.mcp.checkServer(draftServer.id)
      if (result.ok) {
        setInfo('连通性检查通过')
        setError(null)
      } else {
        setError(result.message || '连通性检查失败')
      }
      await loadToolsAndLogs(draftServer)
    } catch (err) {
      setError(err instanceof Error ? err.message : '连通性检查失败')
    } finally {
      setOperationBusy(false)
    }
  }

  const updateToolPolicy = async (toolName: string, updates: { enabled?: boolean; autoApprove?: boolean }) => {
    if (!draftServer || !window.intools?.ai?.mcp?.upsertServer) return

    const disabled = new Set(draftServer.disabledTools || [])
    const disabledAutoApprove = new Set(draftServer.disabledAutoApproveTools || [])

    if (updates.enabled !== undefined) {
      if (updates.enabled) {
        disabled.delete(toolName)
      } else {
        disabled.add(toolName)
      }
    }

    if (updates.autoApprove !== undefined) {
      if (updates.autoApprove) {
        disabledAutoApprove.delete(toolName)
      } else {
        disabledAutoApprove.add(toolName)
      }
    }

    const nextDraft: AiMcpServer = {
      ...draftServer,
      disabledTools: Array.from(disabled),
      disabledAutoApproveTools: Array.from(disabledAutoApprove)
    }

    setDraftServer(nextDraft)
    setOperationBusy(true)
    try {
      const saved = await window.intools.ai.mcp.upsertServer(nextDraft)
      setDraftServer(saved)
      await loadServers()
      await loadToolsAndLogs(saved)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新工具策略失败')
    } finally {
      setOperationBusy(false)
    }
  }

  const toggleToolDescription = (toolId: string) => {
    setExpandedToolIds((prev) => {
      const next = new Set(prev)
      if (next.has(toolId)) {
        next.delete(toolId)
      } else {
        next.add(toolId)
      }
      return next
    })
  }

  const recomputeToolDescriptionOverflow = useCallback(() => {
    const next = new Set<string>()
    tools.forEach((tool) => {
      const el = toolDescriptionRefs.current[tool.id]
      if (!el) return
      if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) {
        next.add(tool.id)
      }
    })
    setOverflowToolIds(next)
  }, [tools])

  useEffect(() => {
    if (tools.length === 0) {
      setOverflowToolIds(new Set())
      return
    }
    const raf = window.requestAnimationFrame(() => {
      recomputeToolDescriptionOverflow()
    })
    return () => window.cancelAnimationFrame(raf)
  }, [tools, selectedServerId, recomputeToolDescriptionOverflow])

  useEffect(() => {
    const handleResize = () => {
      recomputeToolDescriptionOverflow()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [recomputeToolDescriptionOverflow])

  return (
    <div className="flex h-full flex-col bg-white/50 dark:bg-slate-900/30">
      <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
        <button
          onClick={onBack}
          className="no-drag flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
          title="返回"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">AI Settings</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">MCP 服务器管理</div>
        </div>
        <div className="flex items-center gap-2">
          <button className={`${actionButtonClass} no-drag`} onClick={() => void loadServers()} disabled={loadingServers || operationBusy}>刷新</button>
          <button className={`${actionButtonClass} no-drag`} onClick={handleCreateServer} disabled={operationBusy}>新建服务器</button>
          <button className={`${actionButtonClass} no-drag`} onClick={handleOpenJsonImport} disabled={operationBusy}>JSON 导入</button>
          <button className={`${primaryPillClass} no-drag`} onClick={handleSaveServer} disabled={!draftServer || operationBusy}>保存</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 no-drag">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-200/70 bg-white/60 p-4 dark:border-slate-800/80 dark:bg-slate-900/40">
          <div className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">Servers</div>
          <div className="space-y-2">
            {servers.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300/80 px-3 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                暂无服务器，点击右上角“新建服务器”。
              </div>
            )}
            {servers.map((server) => (
              <button
                key={server.id}
                onClick={() => setSelectedServerId(server.id)}
                className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                  selectedServerId === server.id
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium">{server.name}</div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${server.isActive ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300' : 'bg-slate-500/20 text-slate-500 dark:text-slate-400'}`}>
                    {server.isActive ? '运行中' : '已停止'}
                  </span>
                </div>
                <div className="mt-1 truncate text-[11px] opacity-80">{server.type}</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-16 pt-6">
          <div className="mx-auto max-w-5xl space-y-4">
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
                {info}
              </div>
            )}

            {!draftServer ? (
              <div className={cardClass}>请选择服务器，或新建服务器。</div>
            ) : (
              <>
                <div className={cardClass}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">基础配置</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">MCP 服务器标识、类型与描述信息</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className={actionButtonClass} onClick={handleConnectivityCheck} disabled={operationBusy}>连通性检查</button>
                      <button className={actionButtonClass} onClick={handleRestart} disabled={operationBusy || isNewDraft}>重启</button>
                      <button className={actionButtonClass} onClick={handleDeleteServer} disabled={operationBusy || isNewDraft}>删除</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">服务器 ID</div>
                      <input className={inputClass} value={draftServer.id} onChange={(e) => setDraftServer({ ...draftServer, id: e.target.value })} />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">名称</div>
                      <input className={inputClass} value={draftServer.name} onChange={(e) => setDraftServer({ ...draftServer, name: e.target.value })} />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">类型</div>
                      <UnifiedSelect
                        value={draftServer.type}
                        onChange={(e) => setDraftServer({ ...draftServer, type: e.target.value as AiMcpServer['type'] })}
                      >
                        {SERVER_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </UnifiedSelect>
                    </label>
                    <label className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>运行状态</span>
                        <Switch checked={draftServer.isActive} onChange={() => void handleSetActive(!draftServer.isActive)} disabled={operationBusy || isNewDraft} />
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isNewDraft ? '新建服务器请先保存后再启停' : draftServer.isActive ? '当前已启动' : '当前已停止'}
                      </div>
                    </label>
                    <label className="sm:col-span-2 space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">描述</div>
                      <textarea
                        className={`${inputClass} min-h-[76px]`}
                        value={draftServer.description || ''}
                        onChange={(e) => setDraftServer({ ...draftServer, description: e.target.value })}
                        placeholder="描述该 MCP 服务器用途"
                      />
                    </label>
                  </div>
                </div>

                <div className={cardClass}>
                  <div className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">连接配置</div>
                  {draftServer.type === 'stdio' ? (
                    <div className="grid grid-cols-1 gap-3">
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">Command</div>
                        <input
                          className={inputClass}
                          value={draftServer.command || ''}
                          onChange={(e) => setDraftServer({ ...draftServer, command: e.target.value })}
                          placeholder="例如: npx"
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">Args（每行一个）</div>
                        <textarea
                          className={`${inputClass} min-h-[88px] font-mono`}
                          value={draftArgsText}
                          onChange={(e) => setDraftArgsText(e.target.value)}
                          placeholder="-y\n@modelcontextprotocol/server-filesystem"
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">Env（KEY=VALUE，每行一个）</div>
                        <textarea
                          className={`${inputClass} min-h-[88px] font-mono`}
                          value={draftEnvText}
                          onChange={(e) => setDraftEnvText(e.target.value)}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">Base URL</div>
                        <input
                          className={inputClass}
                          value={draftServer.baseUrl || ''}
                          onChange={(e) => setDraftServer({ ...draftServer, baseUrl: e.target.value })}
                          placeholder={draftServer.type === 'streamableHttp' ? 'http://localhost:3000/mcp' : 'http://localhost:3000/sse'}
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">Headers（KEY=VALUE，每行一个）</div>
                        <textarea
                          className={`${inputClass} min-h-[88px] font-mono`}
                          value={draftHeadersText}
                          onChange={(e) => setDraftHeadersText(e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                </div>

                <div className={cardClass}>
                  <div className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">执行策略</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">超时（秒）</div>
                      <input
                        type="number"
                        min={1}
                        className={inputClass}
                        value={String(draftServer.timeoutSec || 60)}
                        onChange={(e) => {
                          const value = Number(e.target.value)
                          setDraftServer({ ...draftServer, timeoutSec: Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined })
                        }}
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>长任务模式</span>
                        <Switch checked={!!draftServer.longRunning} onChange={() => setDraftServer({ ...draftServer, longRunning: !draftServer.longRunning })} />
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">开启后收到进度会重置 timeout，适合长流程工具。</div>
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs text-slate-500 dark:text-slate-400">安装来源</div>
                      <input className={inputClass} value={draftServer.installSource || 'manual'} disabled />
                    </label>
                    <label className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>信任状态</span>
                        <Switch checked={draftServer.isTrusted !== false} onChange={() => setDraftServer({ ...draftServer, isTrusted: !(draftServer.isTrusted !== false) })} />
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">协议安装服务器建议在确认命令后再信任。</div>
                    </label>
                  </div>
                </div>

                <div className={cardClass}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">工具策略</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">支持逐个工具启停与自动批准策略</div>
                    </div>
                    <button className={actionButtonClass} onClick={() => selectedServer && void loadToolsAndLogs(selectedServer)} disabled={loadingTools || operationBusy}>
                      刷新工具
                    </button>
                  </div>

                  {!draftServer.isActive ? (
                    <div className={cardClassTight}>服务器未启动，启动后可查看工具列表。</div>
                  ) : loadingTools ? (
                    <div className={cardClassTight}>工具加载中...</div>
                  ) : tools.length === 0 ? (
                    <div className={cardClassTight}>暂无工具或工具拉取失败。</div>
                  ) : (
                    <div className="space-y-2">
                      {tools.map((tool) => {
                        const enabled = !(draftServer.disabledTools || []).includes(tool.name)
                        const autoApprove = !(draftServer.disabledAutoApproveTools || []).includes(tool.name)
                        const description = tool.description || tool.id
                        const isExpanded = expandedToolIds.has(tool.id)
                        const showExpand = isExpanded || overflowToolIds.has(tool.id)
                        return (
                          <div key={tool.id} className={`${cardClassTight} flex items-center justify-between gap-3`}>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{tool.name}</div>
                              {isExpanded ? (
                                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500 dark:text-slate-400">
                                  {description}
                                  {showExpand && (
                                    <>
                                      {' '}
                                      <button
                                        type="button"
                                        className="inline text-[11px] text-slate-500 underline underline-offset-2 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                        onClick={() => toggleToolDescription(tool.id)}
                                      >
                                        收起
                                      </button>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                  <span
                                    ref={(el) => {
                                      toolDescriptionRefs.current[tool.id] = el
                                    }}
                                    className="min-w-0 flex-1 truncate"
                                  >
                                    {description}
                                  </span>
                                  {showExpand && (
                                    <button
                                      type="button"
                                      className="shrink-0 text-[11px] text-slate-500 underline underline-offset-2 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                      onClick={() => toggleToolDescription(tool.id)}
                                    >
                                      展开
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span>启用</span>
                                <Switch checked={enabled} onChange={() => void updateToolPolicy(tool.name, { enabled: !enabled })} disabled={operationBusy} />
                              </div>
                              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span>自动批准</span>
                                <Switch checked={autoApprove} onChange={() => void updateToolPolicy(tool.name, { autoApprove: !autoApprove })} disabled={operationBusy || !enabled} />
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className={cardClass}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">服务日志</div>
                    <button className={actionButtonClass} onClick={() => selectedServer && void loadToolsAndLogs(selectedServer)} disabled={operationBusy}>刷新日志</button>
                  </div>
                  {logs.length === 0 ? (
                    <div className={cardClassTight}>暂无日志。</div>
                  ) : (
                    <div className="max-h-64 space-y-2 overflow-auto rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800/80 dark:bg-slate-950/60">
                      {logs.map((entry, index) => (
                        <div key={`${entry.timestamp}-${index}`} className="text-xs">
                          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                            <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                            <span className="rounded bg-slate-200/70 px-1.5 py-0.5 uppercase dark:bg-slate-800">{entry.level}</span>
                            {entry.source && <span>{entry.source}</span>}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{entry.message}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {trustConfirmServer && (
        <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900">
            <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">信任确认</div>
            <div className="mb-2 text-xs text-slate-600 dark:text-slate-300">
              该服务器来自协议安装（`protocol`）。首次启用前请确认下面的命令/地址可信。
            </div>
            <div className={cardClassTight}>
              <div className="mb-1 text-[11px] uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Command Preview</div>
              <pre className="whitespace-pre-wrap break-all text-xs text-slate-700 dark:text-slate-200">
                {buildServerCommandPreview(trustConfirmServer)}
              </pre>
            </div>
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              服务器：{trustConfirmServer.name}（{trustConfirmServer.id}）
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className={`${actionButtonClass} no-drag`}
                onClick={() => setTrustConfirmServer(null)}
                disabled={operationBusy}
              >
                取消
              </button>
              <button
                className={`${primaryPillClass} no-drag`}
                onClick={() => void handleTrustConfirmAndActivate()}
                disabled={operationBusy}
              >
                信任并启用
              </button>
            </div>
          </div>
        </div>
      )}

      {jsonImportOpen && (
        <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-4xl rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">从 JSON 导入 MCP 服务器</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">兼容 Cherry Studio 的 mcpServers 格式（stdio / sse / streamableHttp）</div>
              </div>
              <button
                className={`${actionButtonClass} no-drag`}
                onClick={() => {
                  setJsonImportOpen(false)
                  setJsonImportError(null)
                }}
              >
                关闭
              </button>
            </div>

            {jsonImportError && (
              <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
                {jsonImportError}
              </div>
            )}

            <label className="mb-3 block space-y-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">JSON 配置</div>
              <textarea
                className={`${inputClass} min-h-[260px] font-mono no-drag`}
                value={jsonImportText}
                onChange={(e) => setJsonImportText(e.target.value)}
                placeholder={JSON_IMPORT_PLACEHOLDER}
              />
            </label>

            <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className={cardClassTight}>
                <div className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">stdio 示例</div>
                <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-500 dark:text-slate-400">{`{"mcpServers":{"demo":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem"]}}}`}</pre>
              </div>
              <div className={cardClassTight}>
                <div className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">sse 示例</div>
                <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-500 dark:text-slate-400">{`{"mcpServers":{"demo":{"type":"sse","url":"http://localhost:3000/sse"}}}`}</pre>
              </div>
              <div className={cardClassTight}>
                <div className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">streamableHttp 示例</div>
                <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-500 dark:text-slate-400">{`{"mcpServers":{"demo":{"type":"streamableHttp","url":"http://localhost:3000/mcp"}}}`}</pre>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                className={`${actionButtonClass} no-drag`}
                onClick={() => {
                  setJsonImportOpen(false)
                  setJsonImportError(null)
                }}
                disabled={operationBusy}
              >
                取消
              </button>
              <button className={`${primaryPillClass} no-drag`} onClick={() => void handleImportJsonServer()} disabled={operationBusy}>
                导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
