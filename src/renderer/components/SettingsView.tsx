import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  AiToolCapabilityGrant,
  AppShortcutAction,
  CommandAuditItem,
  CommandRule,
  ShortcutStatusMap,
  StoreSource
} from '../../shared/types/settings'
import UnifiedSelect from './UnifiedSelect'
type SettingsSection =
  | 'general'
  | 'appearance'
  | 'shortcuts'
  | 'store'
  | 'permissions'
  | 'security'
  | 'developer'
  | 'about'

interface SettingsViewProps {
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  onClose: () => void
  onOpenPluginManager: () => void
  onOpenBackgroundPluginManager?: () => void
  onOpenTaskScheduler?: () => void
  onOpenLogViewer?: () => void
  onOpenAiSettings?: () => void
}

const SECTION_ITEMS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: '通用' },
  { id: 'appearance', label: '外观' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'store', label: '插件商店' },
  { id: 'permissions', label: '权限' },
  { id: 'security', label: '工具与命令' },
  { id: 'developer', label: '开发者' },
  { id: 'about', label: '关于' }
]
const SHORTCUTS: { id: AppShortcutAction; label: string; description: string }[] = [
  { id: 'toggleWindow', label: '唤起主窗口', description: '显示或隐藏主窗口' },
  { id: 'openSettings', label: '打开设置', description: '直接进入设置面板' },
  { id: 'openPluginStore', label: '打开插件商店', description: '直接进入插件商店页面' },
  { id: 'openPluginManager', label: '打开插件管理', description: '直接进入插件管理页面' }
]

const PERMISSIONS = [
  { id: 'accessibility', label: '辅助功能' },
  { id: 'screen', label: '屏幕录制' },
  { id: 'microphone', label: '麦克风' },
  { id: 'camera', label: '摄像头' },
  { id: 'geolocation', label: '定位' }
] as const

const TOOL_CAPABILITY_OPTIONS = [
  { value: 'shell.exec', label: 'shell.exec（执行系统命令）' },
  { value: 'shell.script', label: 'shell.script（执行预置脚本）' },
  { value: 'fs.read', label: 'fs.read（读取文件）' },
  { value: 'fs.list', label: 'fs.list（列出目录）' },
  { value: 'fs.search', label: 'fs.search（文本检索）' },
  { value: 'patch.apply', label: 'patch.apply（补丁校验/应用）' },
  { value: 'http.fetch', label: 'http.fetch（HTTP 请求）' },
  { value: 'git.status', label: 'git.status（仓库状态）' },
  { value: 'git.diff', label: 'git.diff（差异查看）' }
] as const
const DEFAULT_APP_CAPABILITIES = TOOL_CAPABILITY_OPTIONS.map((item) => item.value)

function formatPermissionStatus(status: string) {
  switch (status) {
    case 'granted':
      return '已授权'
    case 'denied':
      return '已拒绝'
    case 'not-determined':
      return '未确定'
    case 'restricted':
      return '受限'
    case 'limited':
      return '受限访问'
    default:
      return '未知'
  }
}

function parseListDraft(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatCommandAuditStatus(status: string): string {
  switch (status) {
    case 'allowed':
      return '允许'
    case 'blocked':
      return '拦截'
    case 'timeout':
      return '超时'
    case 'error':
      return '错误'
    default:
      return status
  }
}

function formatCapabilityLabel(capability: string): string {
  const row = TOOL_CAPABILITY_OPTIONS.find((item) => item.value === capability)
  return row?.label || capability
}

function toDateTimeLocalValue(input?: number): string {
  if (!input || !Number.isFinite(input)) return ''
  const date = new Date(input)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeShortcutKey(event: KeyboardEvent) {
  const code = event.code
  const key = event.key
  if (key === 'Escape' || key === 'Dead') {
    return null
  }

  const codeMap: Record<string, string> = {
    Space: 'Space',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: '\'',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  }

  if (code in codeMap) {
    return codeMap[code]
  }

  if (code.startsWith('Key')) {
    return code.slice(3).toUpperCase()
  }

  if (code.startsWith('Digit')) {
    return code.slice(5)
  }

  if (code.startsWith('F')) {
    return code
  }

  return null
}

function ShortcutInput({
  label,
  description,
  value,
  status,
  onChange,
  onRecordStart,
  onRecordEnd
}: {
  label: string
  description: string
  value: string
  status?: ShortcutStatusMap[keyof ShortcutStatusMap]
  onChange: (next: string) => void
  onRecordStart: () => void
  onRecordEnd: () => void
}) {
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecording(false)
        setError(null)
        setPreview(null)
        onRecordEnd()
        return
      }

      const mainKey = normalizeShortcutKey(event)
      const parts: string[] = []
      if (event.metaKey || event.ctrlKey) {
        parts.push('CommandOrControl')
      }
      if (event.altKey) {
        parts.push('Alt')
      }
      if (event.shiftKey) {
        parts.push('Shift')
      }
      if (mainKey) {
        parts.push(mainKey)
      }
      const accelerator = parts.join('+')
      setPreview(accelerator)

      const hasPrimaryModifier = event.metaKey || event.ctrlKey || event.altKey
      if (!mainKey || !hasPrimaryModifier) {
        setError('需要至少一个修饰键')
        return
      }

      setRecording(false)
      setError(null)
      setPreview(null)
      onRecordEnd()
      onChange(accelerator)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recording, onChange, onRecordEnd])

  const statusText = status?.ok
    ? ''
    : status?.reason === 'duplicate'
      ? '快捷键冲突'
      : status?.reason === 'in-use'
        ? '被系统占用'
        : status?.reason === 'invalid'
          ? '格式无效'
          : '注册失败'

  const displayValue = recording ? (preview || '按下快捷键') : (value || '未设置')

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900 sm:p-5">
      <div className="space-y-3">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{label}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{description}</div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[200px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            <div className="text-sm font-medium">{displayValue}</div>
            {(error || statusText) && (
              <div className="text-xs text-red-500">{error || statusText}</div>
            )}
          </div>
          <button
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${recording
              ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
              }`}
            onClick={() => {
              setError(null)
              setRecording(true)
              onRecordStart()
            }}
          >
            {recording ? '按下快捷键' : '录制'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SettingsView({ section, onSectionChange, onClose, onOpenPluginManager, onOpenBackgroundPluginManager, onOpenTaskScheduler, onOpenLogViewer, onOpenAiSettings }: SettingsViewProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system')
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatusMap | null>(null)
  const [permissionStatus, setPermissionStatus] = useState<Record<string, string>>({})
  const [commandAudit, setCommandAudit] = useState<CommandAuditItem[]>([])
  const [allowRuleDraft, setAllowRuleDraft] = useState<{ mode: 'exact' | 'prefix'; value: string }>({
    mode: 'exact',
    value: ''
  })
  const [denyRuleDraft, setDenyRuleDraft] = useState<{ mode: 'exact' | 'prefix'; value: string }>({
    mode: 'exact',
    value: ''
  })
  const [filesystemRootDraft, setFilesystemRootDraft] = useState('')
  const [patchRootDraft, setPatchRootDraft] = useState('')
  const [gitRootDraft, setGitRootDraft] = useState('')
  const [denyHostDraft, setDenyHostDraft] = useState('')
  const [denyCidrDraft, setDenyCidrDraft] = useState('')
  const [denyPrefixDraft, setDenyPrefixDraft] = useState('')
  const [appCapabilityDraft, setAppCapabilityDraft] = useState('')
  const [grantDraft, setGrantDraft] = useState<{
    capability: string
    decision: 'allow' | 'deny'
    expiresAt: string
  }>({
    capability: 'shell.exec',
    decision: 'deny',
    expiresAt: ''
  })
  const [runScriptDraft, setRunScriptDraft] = useState({
    id: '',
    command: '',
    args: '',
    cwd: '',
    timeoutMs: '',
    allowEnvKeys: ''
  })
  const [appInfo, setAppInfo] = useState<{ name: string; version: string; userDataPath: string } | null>(null)
  const [newSource, setNewSource] = useState<{ name: string; url: string }>({ name: '', url: '' })
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [_activeRecordings, setActiveRecordings] = useState(0)

  useEffect(() => {
    window.intools.settings.get().then(({ settings, shortcutStatus }) => {
      setSettings(settings)
      setShortcutStatus(shortcutStatus)
    })
    window.intools.theme.get().then((info) => setThemeMode(info.mode))
    window.intools.system.getAppInfo().then((info) => {
      setAppInfo({ name: info.name, version: info.version, userDataPath: info.userDataPath })
    })
  }, [])

  useEffect(() => {
    if (section !== 'permissions') return
    const load = async () => {
      const next: Record<string, string> = {}
      for (const item of PERMISSIONS) {
        next[item.id] = await window.intools.permission.getStatus(item.id)
      }
      setPermissionStatus(next)
    }
    void load()
  }, [section])

  useEffect(() => {
    if (section !== 'security') return
    const loadAudit = async () => {
      if (!window.intools?.shell?.listRunCommandAudit) {
        setCommandAudit([])
        return
      }
      try {
        const records = await window.intools.shell.listRunCommandAudit(100)
        setCommandAudit(records)
      } catch {
        setCommandAudit([])
      }
    }
    void loadAudit()
  }, [section, settings?.commandRunner.audit.records.length])

  const sources = settings?.storeSources ?? []
  const visibleCapabilityGrants = useMemo(() => {
    if (!settings) return []
    return settings.aiTooling.capabilityPolicy.globalGrants || []
  }, [settings])
  const isDefaultAppCapabilitiesAtDefault = useMemo(() => {
    if (!settings) return true
    const current = settings.aiTooling.capabilityPolicy.defaultAppCapabilities || []
    if (current.length !== DEFAULT_APP_CAPABILITIES.length) return false
    return DEFAULT_APP_CAPABILITIES.every((value, index) => current[index] === value)
  }, [settings])

  const updateSettings = async (partial: Partial<AppSettings>) => {
    const result = await window.intools.settings.update(partial)
    setSettings(result.settings)
    setShortcutStatus(result.shortcutStatus)
  }

  const reloadSettings = async () => {
    const result = await window.intools.settings.get()
    setSettings(result.settings)
    setShortcutStatus(result.shortcutStatus)
  }

  const updateCommandRunner = async (patch: Partial<AppSettings['commandRunner']>) => {
    if (!settings) return
    await updateSettings({
      commandRunner: {
        ...settings.commandRunner,
        ...patch
      }
    })
  }

  const updateAiTooling = async (patch: Partial<AppSettings['aiTooling']>) => {
    if (!settings) return
    await updateSettings({
      aiTooling: {
        ...settings.aiTooling,
        ...patch
      }
    })
  }

  const updateAiFilesystem = async (patch: Partial<AppSettings['aiTooling']['filesystem']>) => {
    if (!settings) return
    await updateAiTooling({
      filesystem: {
        ...settings.aiTooling.filesystem,
        ...patch
      }
    })
  }

  const updateAiPatch = async (patch: Partial<AppSettings['aiTooling']['patch']>) => {
    if (!settings) return
    await updateAiTooling({
      patch: {
        ...settings.aiTooling.patch,
        ...patch
      }
    })
  }

  const updateAiGit = async (patch: Partial<AppSettings['aiTooling']['git']>) => {
    if (!settings) return
    await updateAiTooling({
      git: {
        ...settings.aiTooling.git,
        ...patch
      }
    })
  }

  const updateAiHttp = async (patch: Partial<AppSettings['aiTooling']['http']>) => {
    if (!settings) return
    await updateAiTooling({
      http: {
        ...settings.aiTooling.http,
        ...patch
      }
    })
  }

  const updateAiRunScript = async (patch: Partial<AppSettings['aiTooling']['runScript']>) => {
    if (!settings) return
    await updateAiTooling({
      runScript: {
        ...settings.aiTooling.runScript,
        ...patch
      }
    })
  }

  const updateAiCapabilityPolicy = async (patch: Partial<AppSettings['aiTooling']['capabilityPolicy']>) => {
    if (!settings) return
    const current = settings.aiTooling.capabilityPolicy
    await updateAiTooling({
      capabilityPolicy: {
        defaultAppCapabilities: patch.defaultAppCapabilities ?? current.defaultAppCapabilities,
        globalGrants: patch.globalGrants ?? current.globalGrants
      }
    })
  }

  const addUniqueListItem = (list: string[], draft: string): string[] => {
    const parsed = parseListDraft(draft)
    if (parsed.length === 0) return list
    const next = [...list]
    const seen = new Set(list.map((item) => item.toLowerCase()))
    for (const item of parsed) {
      const token = item.toLowerCase()
      if (seen.has(token)) continue
      seen.add(token)
      next.push(item)
    }
    return next
  }

  const addFilesystemRoot = async () => {
    if (!settings) return
    const next = addUniqueListItem(settings.aiTooling.filesystem.allowedRoots || [], filesystemRootDraft)
    if (next.length === settings.aiTooling.filesystem.allowedRoots.length) return
    await updateAiFilesystem({ allowedRoots: next })
    setFilesystemRootDraft('')
  }

  const removeFilesystemRoot = async (value: string) => {
    if (!settings) return
    const next = (settings.aiTooling.filesystem.allowedRoots || []).filter((item) => item !== value)
    await updateAiFilesystem({ allowedRoots: next })
  }

  const addPatchRoot = async () => {
    if (!settings) return
    const next = addUniqueListItem(settings.aiTooling.patch.allowedRoots || [], patchRootDraft)
    if (next.length === settings.aiTooling.patch.allowedRoots.length) return
    await updateAiPatch({ allowedRoots: next })
    setPatchRootDraft('')
  }

  const removePatchRoot = async (value: string) => {
    if (!settings) return
    const next = (settings.aiTooling.patch.allowedRoots || []).filter((item) => item !== value)
    await updateAiPatch({ allowedRoots: next })
  }

  const addGitRoot = async () => {
    if (!settings) return
    const next = addUniqueListItem(settings.aiTooling.git.allowedRepoRoots || [], gitRootDraft)
    if (next.length === settings.aiTooling.git.allowedRepoRoots.length) return
    await updateAiGit({ allowedRepoRoots: next })
    setGitRootDraft('')
  }

  const removeGitRoot = async (value: string) => {
    if (!settings) return
    const next = (settings.aiTooling.git.allowedRepoRoots || []).filter((item) => item !== value)
    await updateAiGit({ allowedRepoRoots: next })
  }

  const addHttpDenyHost = async () => {
    if (!settings) return
    const next = addUniqueListItem(settings.aiTooling.http.denyHosts || [], denyHostDraft)
    if (next.length === settings.aiTooling.http.denyHosts.length) return
    await updateAiHttp({ denyHosts: next })
    setDenyHostDraft('')
  }

  const removeHttpDenyHost = async (value: string) => {
    if (!settings) return
    const next = (settings.aiTooling.http.denyHosts || []).filter((item) => item !== value)
    await updateAiHttp({ denyHosts: next })
  }

  const addHttpDenyCidr = async () => {
    if (!settings) return
    const next = addUniqueListItem(settings.aiTooling.http.denyCidrs || [], denyCidrDraft)
    if (next.length === settings.aiTooling.http.denyCidrs.length) return
    await updateAiHttp({ denyCidrs: next })
    setDenyCidrDraft('')
  }

  const removeHttpDenyCidr = async (value: string) => {
    if (!settings) return
    const next = (settings.aiTooling.http.denyCidrs || []).filter((item) => item !== value)
    await updateAiHttp({ denyCidrs: next })
  }

  const addHttpDenyPrefix = async () => {
    if (!settings) return
    const next = addUniqueListItem(settings.aiTooling.http.denyUrlPrefixes || [], denyPrefixDraft)
    if (next.length === settings.aiTooling.http.denyUrlPrefixes.length) return
    await updateAiHttp({ denyUrlPrefixes: next })
    setDenyPrefixDraft('')
  }

  const removeHttpDenyPrefix = async (value: string) => {
    if (!settings) return
    const next = (settings.aiTooling.http.denyUrlPrefixes || []).filter((item) => item !== value)
    await updateAiHttp({ denyUrlPrefixes: next })
  }

  const addCapabilityToPolicyList = async (
    key: 'defaultAppCapabilities',
    draft: string,
    reset: () => void
  ) => {
    if (!settings) return
    const next = addUniqueListItem(settings.aiTooling.capabilityPolicy[key] || [], draft)
    if (next.length === settings.aiTooling.capabilityPolicy[key].length) return
    await updateAiCapabilityPolicy({ [key]: next })
    reset()
  }

  const removeCapabilityFromPolicyList = async (
    key: 'defaultAppCapabilities',
    capability: string
  ) => {
    if (!settings) return
    const next = (settings.aiTooling.capabilityPolicy[key] || []).filter((item) => item !== capability)
    await updateAiCapabilityPolicy({ [key]: next })
  }

  const restoreDefaultAppCapabilities = async () => {
    if (!settings) return
    await updateAiCapabilityPolicy({
      defaultAppCapabilities: [...DEFAULT_APP_CAPABILITIES]
    })
  }

  const addCapabilityGrant = async () => {
    if (!settings) return
    const capability = grantDraft.capability.trim()
    if (!capability) return

    const exists = (settings.aiTooling.capabilityPolicy.globalGrants || []).some((item) =>
      item.capability === capability &&
      item.decision === grantDraft.decision
    )
    if (exists) return

    const now = Date.now()
    const expiresAtMs = grantDraft.expiresAt ? Date.parse(grantDraft.expiresAt) : undefined
    const expiresAt = Number.isFinite(expiresAtMs || NaN) ? expiresAtMs : undefined

    const nextGrant: AiToolCapabilityGrant = {
      id: `grant-${now}-${Math.random().toString(36).slice(2, 8)}`,
      capability,
      decision: grantDraft.decision,
      createdAt: now,
      updatedAt: now,
      expiresAt
    }

    await updateAiCapabilityPolicy({
      globalGrants: [...(settings.aiTooling.capabilityPolicy.globalGrants || []), nextGrant]
    })

    setGrantDraft((prev) => ({
      ...prev,
      expiresAt: ''
    }))
  }

  const removeCapabilityGrant = async (grantId: string) => {
    if (!settings) return
    const next = (settings.aiTooling.capabilityPolicy.globalGrants || []).filter((item) => item.id !== grantId)
    await updateAiCapabilityPolicy({ globalGrants: next })
  }

  const patchCapabilityGrant = async (grantId: string, patch: Partial<AiToolCapabilityGrant>) => {
    if (!settings) return
    const now = Date.now()
    const next = (settings.aiTooling.capabilityPolicy.globalGrants || []).map((item) => (
      item.id === grantId
        ? {
          ...item,
          ...patch,
          updatedAt: now
        }
        : item
    ))
    await updateAiCapabilityPolicy({ globalGrants: next })
  }

  const updateRunScriptEntry = async (
    index: number,
    patch: Partial<AppSettings['aiTooling']['runScript']['entries'][number]>
  ) => {
    if (!settings) return
    const entries = [...(settings.aiTooling.runScript.entries || [])]
    if (!entries[index]) return
    entries[index] = {
      ...entries[index],
      ...patch
    }
    await updateAiRunScript({ entries })
  }

  const removeRunScriptEntry = async (index: number) => {
    if (!settings) return
    const entries = (settings.aiTooling.runScript.entries || []).filter((_, i) => i !== index)
    await updateAiRunScript({ entries })
  }

  const addRunScriptEntry = async () => {
    if (!settings) return
    const id = runScriptDraft.id.trim()
    const command = runScriptDraft.command.trim()
    if (!id || !command) return
    const exists = (settings.aiTooling.runScript.entries || []).some((item) => item.id === id)
    if (exists) return
    const args = parseListDraft(runScriptDraft.args)
    const allowEnvKeys = parseListDraft(runScriptDraft.allowEnvKeys)
    const timeoutRaw = Number(runScriptDraft.timeoutMs)
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined

    const nextEntry: AppSettings['aiTooling']['runScript']['entries'][number] = {
      id,
      command,
      args: args.length > 0 ? args : undefined,
      cwd: runScriptDraft.cwd.trim() || undefined,
      timeoutMs,
      allowEnvKeys: allowEnvKeys.length > 0 ? allowEnvKeys : undefined
    }

    await updateAiRunScript({
      entries: [...(settings.aiTooling.runScript.entries || []), nextEntry]
    })
    setRunScriptDraft({
      id: '',
      command: '',
      args: '',
      cwd: '',
      timeoutMs: '',
      allowEnvKeys: ''
    })
  }

  const addCommandRule = async (type: 'allowList' | 'denyList') => {
    if (!settings) return
    const draft = type === 'allowList' ? allowRuleDraft : denyRuleDraft
    const value = draft.value.trim()
    if (!value) return
    const nextRule: CommandRule = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      mode: draft.mode,
      value,
      enabled: true
    }
    const nextRules = [...(settings.commandRunner[type] || []), nextRule]
    await updateCommandRunner({ [type]: nextRules })
    if (type === 'allowList') {
      setAllowRuleDraft({ mode: draft.mode, value: '' })
    } else {
      setDenyRuleDraft({ mode: draft.mode, value: '' })
    }
  }

  const removeCommandRule = async (type: 'allowList' | 'denyList', ruleId: string) => {
    if (!settings) return
    const nextRules = (settings.commandRunner[type] || []).filter((item) => item.id !== ruleId)
    await updateCommandRunner({ [type]: nextRules })
  }

  const patchCommandRule = async (type: 'allowList' | 'denyList', ruleId: string, patch: Partial<CommandRule>) => {
    if (!settings) return
    const nextRules = (settings.commandRunner[type] || []).map((item) => (
      item.id === ruleId ? { ...item, ...patch } : item
    ))
    await updateCommandRunner({ [type]: nextRules })
  }

  const handleRecordStart = async () => {
    setActiveRecordings((count) => {
      const next = count + 1
      if (next === 1) {
        window.intools.settings.pauseShortcuts()
      }
      return next
    })
  }

  const handleRecordEnd = async () => {
    setActiveRecordings((count) => {
      const next = Math.max(0, count - 1)
      if (next === 0) {
        window.intools.settings.resumeShortcuts().then(setShortcutStatus)
      }
      return next
    })
  }

  const handleShortcutChange = async (action: AppShortcutAction, accelerator: string) => {
    if (!settings) return
    await updateSettings({
      shortcuts: {
        ...settings.shortcuts,
        [action]: accelerator
      }
    })
  }

  const handleAddSource = async () => {
    const name = newSource.name.trim()
    const url = newSource.url.trim()
    if (!name || !url) {
      setSourceError('名称和地址不能为空')
      return
    }

    try {
      new URL(url)
    } catch {
      setSourceError('地址格式不正确')
      return
    }

    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `source-${Date.now()}`
    const nextSource: StoreSource = {
      id,
      name,
      url,
      enabled: true,
      priority: sources.length + 1
    }
    setSourceError(null)
    setNewSource({ name: '', url: '' })
    await updateSettings({ storeSources: [...sources, nextSource] })
  }

  const handleToggleSource = async (id: string, enabled: boolean) => {
    const next = sources.map(source => source.id === id ? { ...source, enabled } : source)
    await updateSettings({ storeSources: next })
  }

  const handleRemoveSource = async (id: string) => {
    const next = sources.filter(source => source.id !== id)
    await updateSettings({ storeSources: next })
  }

  const currentSectionLabel = useMemo(
    () => SECTION_ITEMS.find(item => item.id === section)?.label ?? '',
    [section]
  )
  const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white p-6 dark:border-slate-800/80 dark:bg-slate-900'
  const cardClassTight = 'rounded-[24px] border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900'
  const pillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white'
  const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'

  return (
    <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-500/20" />
        <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-[120px] dark:bg-emerald-400/10" />
        <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-indigo-200/30 blur-[120px] dark:bg-indigo-500/10" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
            title="返回"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Settings / 设置</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{currentSectionLabel}</div>
          </div>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          <aside className="w-56 shrink-0 border-r border-slate-200/70 bg-white dark:border-slate-800/80 dark:bg-slate-900 no-drag">
            <nav className="flex flex-col gap-1 p-4">
              {SECTION_ITEMS.map(item => (
                <button
                  key={item.id}
                  className={`w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors ${item.id === section
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white'
                    }`}
                  onClick={() => onSectionChange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>

          <main className="flex-1 min-h-0 overflow-auto no-drag">
            <div className="mx-auto max-w-5xl px-6 pb-16 pt-8">
              {section === 'general' && (
                <div className="space-y-4">
                  <div className={`${cardClass} text-sm text-slate-600 dark:text-slate-300`}>
                    通用设置将在后续版本提供。
                  </div>
                  {onOpenAiSettings && (
                    <div className={`${cardClass} flex items-center justify-between gap-4`}>
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">AI 设置中心</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">配置 Provider、模型与默认策略</div>
                      </div>
                      <button className={primaryPillClass} onClick={onOpenAiSettings}>
                        打开 AI 设置
                      </button>
                    </div>
                  )}
                  <div className={`${cardClass} flex items-center justify-between gap-4`}>
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-white">插件管理</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">管理插件启用状态、更新与卸载</div>
                    </div>
                    <button className={primaryPillClass} onClick={onOpenPluginManager}>
                      打开插件管理
                    </button>
                  </div>
                  {onOpenBackgroundPluginManager && (
                    <div className={`${cardClass} flex items-center justify-between gap-4`}>
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">运行中的插件</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">查看和管理所有正在运行的插件</div>
                      </div>
                      <button className={primaryPillClass} onClick={onOpenBackgroundPluginManager}>
                        打开任务管理器
                      </button>
                    </div>
                  )}
                  {onOpenTaskScheduler && (
                    <div className={`${cardClass} flex items-center justify-between gap-4`}>
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">任务调度器</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">查看和管理所有定时任务</div>
                      </div>
                      <button className={primaryPillClass} onClick={onOpenTaskScheduler}>
                        打开任务调度器
                      </button>
                    </div>
                  )}
                </div>
              )}

              {section === 'appearance' && (
                <div className={`${cardClass} space-y-4`}>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">主题模式</div>
                  <div className="flex flex-wrap gap-3">
                    {(['light', 'dark', 'system'] as const).map((mode) => (
                      <button
                        key={mode}
                        className={`rounded-full border px-4 py-2 text-sm transition-colors ${themeMode === mode
                          ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                          }`}
                        onClick={async () => {
                          const info = await window.intools.theme.set(mode)
                          setThemeMode(info.mode)
                        }}
                      >
                        {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {section === 'shortcuts' && settings && (
                <div className="space-y-3">
                  {SHORTCUTS.map(item => (
                    <ShortcutInput
                      key={item.id}
                      label={item.label}
                      description={item.description}
                      value={settings.shortcuts[item.id]}
                      status={shortcutStatus?.[item.id]}
                      onChange={(accelerator) => handleShortcutChange(item.id, accelerator)}
                      onRecordStart={handleRecordStart}
                      onRecordEnd={handleRecordEnd}
                    />
                  ))}
                </div>
              )}

              {section === 'store' && settings && (
                <div className="space-y-6">
                  <div>
                    <div className="mb-2 text-sm font-medium text-slate-900 dark:text-white">插件源</div>
                    <div className="space-y-3">
                      {sources.length === 0 && (
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          还没有添加任何插件源。
                        </div>
                      )}
                      {sources.map(source => (
                        <div
                          key={source.id}
                          className={`${cardClassTight} flex items-center justify-between gap-4`}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-white">{source.name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{source.url}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              className={source.enabled ? primaryPillClass : pillClass}
                              onClick={() => handleToggleSource(source.id, !source.enabled)}
                            >
                              {source.enabled ? '已启用' : '已停用'}
                            </button>
                            <button
                              className={actionButtonClass}
                              onClick={() => handleRemoveSource(source.id)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-medium text-slate-900 dark:text-white">新增插件源</div>
                    <div className="grid grid-cols-1 gap-3">
                      <input
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                        placeholder="来源名称"
                        value={newSource.name}
                        onChange={(e) => setNewSource(prev => ({ ...prev, name: e.target.value }))}
                      />
                      <input
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                        placeholder="JSON 索引地址"
                        value={newSource.url}
                        onChange={(e) => setNewSource(prev => ({ ...prev, url: e.target.value }))}
                      />
                      {sourceError && (
                        <div className="text-xs text-red-500">{sourceError}</div>
                      )}
                      <button
                        className="inline-flex items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                        onClick={handleAddSource}
                      >
                        添加来源
                      </button>
                    </div>
                  </div>
                </div>
              )}


              {section === 'permissions' && (
                <div className="space-y-3">
                  {PERMISSIONS.map(item => (
                    <div
                      key={item.id}
                      className={`${cardClassTight} flex items-center justify-between gap-4`}
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {formatPermissionStatus(permissionStatus[item.id])}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className={actionButtonClass}
                          onClick={() => window.intools.permission.openSystemSettings(item.id)}
                        >
                          打开系统设置
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {section === 'security' && settings && (
                <div className="space-y-5">
                  <div className={`${cardClass} space-y-4`}>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">命令执行总开关</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      这部分控制 `shell:runCommand` 的统一安全策略（独立于 Skill capability 授权层）。
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 dark:border-slate-800/80">
                      <div>
                        <div className="text-sm text-slate-900 dark:text-white">启用 runCommand</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">关闭后将拒绝所有命令执行请求</div>
                      </div>
                      <button
                        className={`relative w-11 h-6 rounded-full transition-colors ${settings.commandRunner.enabled
                          ? 'bg-blue-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        onClick={() => void updateCommandRunner({ enabled: !settings.commandRunner.enabled })}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.commandRunner.enabled ? 'translate-x-5' : ''}`}
                        />
                      </button>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 dark:border-slate-800/80">
                      <div>
                        <div className="text-sm text-slate-900 dark:text-white">首次启用确认</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">同一命令指纹首次执行时弹窗确认</div>
                      </div>
                      <button
                        className={`relative w-11 h-6 rounded-full transition-colors ${settings.commandRunner.requireConsent
                          ? 'bg-blue-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        onClick={() => void updateCommandRunner({ requireConsent: !settings.commandRunner.requireConsent })}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.commandRunner.requireConsent ? 'translate-x-5' : ''}`}
                        />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-slate-900 dark:text-white">允许 shell=true</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">启用后可执行 shell 解析命令，风险更高</div>
                      </div>
                      <button
                        className={`relative w-11 h-6 rounded-full transition-colors ${settings.commandRunner.allowShell
                          ? 'bg-amber-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        onClick={() => void updateCommandRunner({ allowShell: !settings.commandRunner.allowShell })}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.commandRunner.allowShell ? 'translate-x-5' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  <div className={`${cardClass} space-y-4`}>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">执行限制</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">默认超时（ms）</div>
                        <input
                          type="number"
                          min={1000}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.commandRunner.defaultTimeoutMs}
                          onChange={(e) => void updateCommandRunner({ defaultTimeoutMs: Number(e.target.value || 0) })}
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">最大超时（ms）</div>
                        <input
                          type="number"
                          min={1000}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.commandRunner.maxTimeoutMs}
                          onChange={(e) => void updateCommandRunner({ maxTimeoutMs: Number(e.target.value || 0) })}
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">最大输出（bytes）</div>
                        <input
                          type="number"
                          min={8192}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.commandRunner.maxOutputBytes}
                          onChange={(e) => void updateCommandRunner({ maxOutputBytes: Number(e.target.value || 0) })}
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">最大并发</div>
                        <input
                          type="number"
                          min={1}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.commandRunner.maxConcurrent}
                          onChange={(e) => void updateCommandRunner({ maxConcurrent: Number(e.target.value || 0) })}
                        />
                      </label>
                      <label className="space-y-1 sm:col-span-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400">审计保留条数</div>
                        <input
                          type="number"
                          min={50}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.commandRunner.audit.maxItems}
                          onChange={(e) => void updateCommandRunner({
                            audit: {
                              ...settings.commandRunner.audit,
                              maxItems: Number(e.target.value || 0)
                            }
                          })}
                        />
                      </label>
                    </div>
                  </div>

                  <div className={`${cardClass} space-y-4`}>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">AI 内置工具总开关</div>
                    <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 dark:border-slate-800/80">
                      <div>
                        <div className="text-sm text-slate-900 dark:text-white">启用 aiTooling</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">关闭后将拒绝所有内置工具（read/list/search/patch/http/script/git）</div>
                      </div>
                      <button
                        className={`relative w-11 h-6 rounded-full transition-colors ${settings.aiTooling.enabled
                          ? 'bg-blue-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        onClick={() => void updateAiTooling({ enabled: !settings.aiTooling.enabled })}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.aiTooling.enabled ? 'translate-x-5' : ''}`}
                        />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">filesystem 最大读取（bytes）</div>
                        <input
                          type="number"
                          min={1024}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.aiTooling.filesystem.maxReadBytes}
                          onChange={(e) => void updateAiFilesystem({ maxReadBytes: Number(e.target.value || 0) })}
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">filesystem 搜索命中上限</div>
                        <input
                          type="number"
                          min={10}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.aiTooling.filesystem.maxSearchHits}
                          onChange={(e) => void updateAiFilesystem({ maxSearchHits: Number(e.target.value || 0) })}
                        />
                      </label>
                    </div>
                  </div>

                  <div className={`${cardClass} space-y-4`}>
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">能力授权策略（Capability Policy）</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        工具能力属于 AI 全局底层能力，优先级：会话策略 &gt; grant &gt; 默认能力。
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">defaultAppCapabilities（AI 全局默认能力）</div>
                        <button
                          className={actionButtonClass}
                          disabled={isDefaultAppCapabilitiesAtDefault}
                          onClick={() => void restoreDefaultAppCapabilities()}
                        >
                          恢复默认能力
                        </button>
                      </div>
                      <div className="mb-2 flex flex-wrap gap-2">
                        {(settings.aiTooling.capabilityPolicy.defaultAppCapabilities || []).map((item) => (
                          <button
                            key={`default-app-cap-${item}`}
                            className={pillClass}
                            onClick={() => void removeCapabilityFromPolicyList('defaultAppCapabilities', item)}
                            title="点击删除"
                          >
                            {formatCapabilityLabel(item)}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                        <input
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                          placeholder="输入 capability，支持逗号或换行批量"
                          value={appCapabilityDraft}
                          onChange={(e) => setAppCapabilityDraft(e.target.value)}
                        />
                        <button
                          className={actionButtonClass}
                          onClick={() => void addCapabilityToPolicyList('defaultAppCapabilities', appCapabilityDraft, () => setAppCapabilityDraft(''))}
                        >
                          新增
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70">
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                        globalGrants（全局能力放权规则）
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        仅管理 AI 全局能力规则。
                      </div>

                      <div className="space-y-2">
                        {(visibleCapabilityGrants || []).map((grant) => (
                          <div
                            key={grant.id}
                            className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950 sm:grid-cols-[minmax(0,1fr)_120px_160px_70px]"
                          >
                            <div className="truncate text-slate-700 dark:text-slate-200">
                              {formatCapabilityLabel(grant.capability)}
                            </div>
                            <UnifiedSelect
                              className="rounded-xl px-2 py-1 pr-8 text-xs"
                              value={grant.decision}
                              onChange={(e) => void patchCapabilityGrant(grant.id, { decision: e.target.value as 'allow' | 'deny' })}
                            >
                              <option value="allow">allow（允许）</option>
                              <option value="deny">deny（拒绝）</option>
                            </UnifiedSelect>
                            <input
                              type="datetime-local"
                              className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                              value={toDateTimeLocalValue(grant.expiresAt)}
                              onChange={(e) => {
                                const text = e.target.value
                                const parsed = text ? Date.parse(text) : undefined
                                void patchCapabilityGrant(grant.id, { expiresAt: Number.isFinite(parsed || NaN) ? parsed : undefined })
                              }}
                            />
                            <button className={actionButtonClass} onClick={() => void removeCapabilityGrant(grant.id)}>删除</button>
                          </div>
                        ))}
                        {(visibleCapabilityGrants || []).length === 0 && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">暂无 global grant 规则。</div>
                        )}
                      </div>

                      <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">新增 global grant</div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <UnifiedSelect
                            className="rounded-xl px-2 py-1 pr-8 text-xs"
                            value={grantDraft.capability}
                            onChange={(e) => setGrantDraft((prev) => ({ ...prev, capability: e.target.value }))}
                          >
                            {TOOL_CAPABILITY_OPTIONS.map((item) => (
                              <option key={`cap-option-${item.value}`} value={item.value}>{item.label}</option>
                            ))}
                          </UnifiedSelect>
                          <UnifiedSelect
                            className="rounded-xl px-2 py-1 pr-8 text-xs"
                            value={grantDraft.decision}
                            onChange={(e) => setGrantDraft((prev) => ({ ...prev, decision: e.target.value as 'allow' | 'deny' }))}
                          >
                            <option value="allow">allow（允许）</option>
                            <option value="deny">deny（拒绝）</option>
                          </UnifiedSelect>
                          <input
                            type="datetime-local"
                            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950 sm:col-span-2"
                            placeholder="过期时间（可选）"
                            value={grantDraft.expiresAt}
                            onChange={(e) => setGrantDraft((prev) => ({ ...prev, expiresAt: e.target.value }))}
                          />
                        </div>
                        <div className="flex justify-end">
                          <button className={actionButtonClass} onClick={() => void addCapabilityGrant()}>新增 grant</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`${cardClass} space-y-4`}>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">路径白名单（allowedRoots / allowedRepoRoots）</div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400">filesystem.allowedRoots（文件读取/检索范围）</div>
                        <div className="space-y-2">
                          {(settings.aiTooling.filesystem.allowedRoots || []).map((item) => (
                            <div key={`fs-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                              <div className="truncate">{item}</div>
                              <button className={actionButtonClass} onClick={() => void removeFilesystemRoot(item)}>删除</button>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                          <input
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                            placeholder="新增路径，支持逗号或换行批量"
                            value={filesystemRootDraft}
                            onChange={(e) => setFilesystemRootDraft(e.target.value)}
                          />
                          <button className={actionButtonClass} onClick={() => void addFilesystemRoot()}>新增</button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400">patch.allowedRoots（补丁应用范围）</div>
                        <div className="space-y-2">
                          {(settings.aiTooling.patch.allowedRoots || []).map((item) => (
                            <div key={`patch-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                              <div className="truncate">{item}</div>
                              <button className={actionButtonClass} onClick={() => void removePatchRoot(item)}>删除</button>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                          <input
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                            placeholder="新增路径，支持逗号或换行批量"
                            value={patchRootDraft}
                            onChange={(e) => setPatchRootDraft(e.target.value)}
                          />
                          <button className={actionButtonClass} onClick={() => void addPatchRoot()}>新增</button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400">git.allowedRepoRoots（Git 仓库范围）</div>
                        <div className="space-y-2">
                          {(settings.aiTooling.git.allowedRepoRoots || []).map((item) => (
                            <div key={`git-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                              <div className="truncate">{item}</div>
                              <button className={actionButtonClass} onClick={() => void removeGitRoot(item)}>删除</button>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                          <input
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                            placeholder="新增路径，支持逗号或换行批量"
                            value={gitRootDraft}
                            onChange={(e) => setGitRootDraft(e.target.value)}
                          />
                          <button className={actionButtonClass} onClick={() => void addGitRoot()}>新增</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`${cardClass} space-y-4`}>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">HTTP 黑名单与限制</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">超时（ms）</div>
                        <input
                          type="number"
                          min={1000}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.aiTooling.http.timeoutMs}
                          onChange={(e) => void updateAiHttp({ timeoutMs: Number(e.target.value || 0) })}
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">响应体上限（bytes）</div>
                        <input
                          type="number"
                          min={1024}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.aiTooling.http.maxResponseBytes}
                          onChange={(e) => void updateAiHttp({ maxResponseBytes: Number(e.target.value || 0) })}
                        />
                      </label>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">denyHosts（拒绝访问的域名）</div>
                      {(settings.aiTooling.http.denyHosts || []).map((item) => (
                        <div key={`deny-host-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="truncate">{item}</div>
                          <button className={actionButtonClass} onClick={() => void removeHttpDenyHost(item)}>删除</button>
                        </div>
                      ))}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                        <input
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                          placeholder="例如 localhost, example.com"
                          value={denyHostDraft}
                          onChange={(e) => setDenyHostDraft(e.target.value)}
                        />
                        <button className={actionButtonClass} onClick={() => void addHttpDenyHost()}>新增</button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">denyCidrs（拒绝访问的网段）</div>
                      {(settings.aiTooling.http.denyCidrs || []).map((item) => (
                        <div key={`deny-cidr-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="truncate">{item}</div>
                          <button className={actionButtonClass} onClick={() => void removeHttpDenyCidr(item)}>删除</button>
                        </div>
                      ))}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                        <input
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                          placeholder="例如 127.0.0.0/8"
                          value={denyCidrDraft}
                          onChange={(e) => setDenyCidrDraft(e.target.value)}
                        />
                        <button className={actionButtonClass} onClick={() => void addHttpDenyCidr()}>新增</button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">denyUrlPrefixes（拒绝访问的 URL 前缀）</div>
                      {(settings.aiTooling.http.denyUrlPrefixes || []).map((item) => (
                        <div key={`deny-prefix-${item}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="truncate">{item}</div>
                          <button className={actionButtonClass} onClick={() => void removeHttpDenyPrefix(item)}>删除</button>
                        </div>
                      ))}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                        <input
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                          placeholder="例如 https://internal.example.com/"
                          value={denyPrefixDraft}
                          onChange={(e) => setDenyPrefixDraft(e.target.value)}
                        />
                        <button className={actionButtonClass} onClick={() => void addHttpDenyPrefix()}>新增</button>
                      </div>
                    </div>
                  </div>

                  <div className={`${cardClass} space-y-4`}>
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">runScript 注册表（预置脚本白名单）</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        仅对 `shell.script` 能力生效；不影响 `shell.exec` 的直接命令执行。
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">默认超时（ms）</div>
                        <input
                          type="number"
                          min={1000}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.aiTooling.runScript.defaultTimeoutMs}
                          onChange={(e) => void updateAiRunScript({ defaultTimeoutMs: Number(e.target.value || 0) })}
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs text-slate-500 dark:text-slate-400">最大超时（ms）</div>
                        <input
                          type="number"
                          min={5000}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                          value={settings.aiTooling.runScript.maxTimeoutMs}
                          onChange={(e) => void updateAiRunScript({ maxTimeoutMs: Number(e.target.value || 0) })}
                        />
                      </label>
                    </div>

                    <div className="space-y-3">
                      {(settings.aiTooling.runScript.entries || []).map((entry, index) => (
                        <div key={`script-${entry.id}-${index}`} className="space-y-2 rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input
                              className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                              placeholder="脚本 ID（scriptId）"
                              value={entry.id}
                              onChange={(e) => void updateRunScriptEntry(index, { id: e.target.value })}
                            />
                            <input
                              className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                              placeholder="命令（command）"
                              value={entry.command}
                              onChange={(e) => void updateRunScriptEntry(index, { command: e.target.value })}
                            />
                            <input
                              className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                              placeholder="参数 args（逗号分隔）"
                              value={(entry.args || []).join(', ')}
                              onChange={(e) => void updateRunScriptEntry(index, { args: parseListDraft(e.target.value) })}
                            />
                            <input
                              className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                              placeholder="工作目录 cwd（可选）"
                              value={entry.cwd || ''}
                              onChange={(e) => void updateRunScriptEntry(index, { cwd: e.target.value || undefined })}
                            />
                            <input
                              type="number"
                              min={1000}
                              className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                              placeholder="超时 timeoutMs（可选）"
                              value={entry.timeoutMs || ''}
                              onChange={(e) => {
                                const num = Number(e.target.value || 0)
                                void updateRunScriptEntry(index, { timeoutMs: Number.isFinite(num) && num > 0 ? num : undefined })
                              }}
                            />
                            <input
                              className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                              placeholder="允许环境变量 allowEnvKeys（逗号分隔）"
                              value={(entry.allowEnvKeys || []).join(', ')}
                              onChange={(e) => void updateRunScriptEntry(index, { allowEnvKeys: parseListDraft(e.target.value) })}
                            />
                          </div>
                          <div className="flex justify-end">
                            <button className={actionButtonClass} onClick={() => void removeRunScriptEntry(index)}>删除</button>
                          </div>
                        </div>
                      ))}
                      {(settings.aiTooling.runScript.entries || []).length === 0 && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">暂无脚本条目。</div>
                      )}
                    </div>

                    <div className="space-y-2 rounded-2xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
                      <div className="text-xs text-slate-500 dark:text-slate-400">新增条目</div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                          className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                          placeholder="脚本 ID（scriptId）"
                          value={runScriptDraft.id}
                          onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, id: e.target.value }))}
                        />
                        <input
                          className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                          placeholder="命令（command）"
                          value={runScriptDraft.command}
                          onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, command: e.target.value }))}
                        />
                        <input
                          className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                          placeholder="参数 args（逗号分隔）"
                          value={runScriptDraft.args}
                          onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, args: e.target.value }))}
                        />
                        <input
                          className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                          placeholder="工作目录 cwd（可选）"
                          value={runScriptDraft.cwd}
                          onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, cwd: e.target.value }))}
                        />
                        <input
                          type="number"
                          min={1000}
                          className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                          placeholder="超时 timeoutMs（可选）"
                          value={runScriptDraft.timeoutMs}
                          onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, timeoutMs: e.target.value }))}
                        />
                        <input
                          className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                          placeholder="允许环境变量 allowEnvKeys（逗号分隔）"
                          value={runScriptDraft.allowEnvKeys}
                          onChange={(e) => setRunScriptDraft((prev) => ({ ...prev, allowEnvKeys: e.target.value }))}
                        />
                      </div>
                      <div className="flex justify-end">
                        <button className={actionButtonClass} onClick={() => void addRunScriptEntry()}>新增 runScript 条目</button>
                      </div>
                    </div>
                  </div>

                  <div className={`${cardClass} space-y-4`}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">白名单规则（allowList）</div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{settings.commandRunner.allowList.length}</span>
                    </div>
                    <div className="space-y-2">
                      {settings.commandRunner.allowList.map((rule) => (
                        <div key={rule.id} className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70 sm:grid-cols-[110px_minmax(0,1fr)_80px_70px]">
                          <UnifiedSelect
                            className="rounded-xl px-2 py-1 pr-8 text-xs"
                            value={rule.mode}
                            onChange={(e) => void patchCommandRule('allowList', rule.id, { mode: e.target.value as 'exact' | 'prefix' })}
                          >
                            <option value="exact">exact（精确匹配）</option>
                            <option value="prefix">prefix（前缀匹配）</option>
                          </UnifiedSelect>
                          <input
                            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                            value={rule.value}
                            onChange={(e) => void patchCommandRule('allowList', rule.id, { value: e.target.value })}
                          />
                          <button
                            className={rule.enabled === false ? pillClass : primaryPillClass}
                            onClick={() => void patchCommandRule('allowList', rule.id, { enabled: rule.enabled === false })}
                          >
                            {rule.enabled === false ? '启用' : '停用'}
                          </button>
                          <button className={actionButtonClass} onClick={() => void removeCommandRule('allowList', rule.id)}>删除</button>
                        </div>
                      ))}
                      {settings.commandRunner.allowList.length === 0 && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">为空时表示不启用白名单强约束。</div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[110px_minmax(0,1fr)_100px]">
                      <UnifiedSelect
                        className="rounded-2xl px-3 py-2 pr-9 text-sm"
                        value={allowRuleDraft.mode}
                        onChange={(e) => setAllowRuleDraft((prev) => ({ ...prev, mode: e.target.value as 'exact' | 'prefix' }))}
                      >
                        <option value="exact">exact（精确匹配）</option>
                        <option value="prefix">prefix（前缀匹配）</option>
                      </UnifiedSelect>
                      <input
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                        placeholder="命令或命令前缀（可包含参数）"
                        value={allowRuleDraft.value}
                        onChange={(e) => setAllowRuleDraft((prev) => ({ ...prev, value: e.target.value }))}
                      />
                      <button className={actionButtonClass} onClick={() => void addCommandRule('allowList')}>新增</button>
                    </div>
                  </div>

                  <div className={`${cardClass} space-y-4`}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">黑名单规则（denyList）</div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{settings.commandRunner.denyList.length}</span>
                    </div>
                    <div className="space-y-2">
                      {settings.commandRunner.denyList.map((rule) => (
                        <div key={rule.id} className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/70 sm:grid-cols-[110px_minmax(0,1fr)_80px_70px]">
                          <UnifiedSelect
                            className="rounded-xl px-2 py-1 pr-8 text-xs"
                            value={rule.mode}
                            onChange={(e) => void patchCommandRule('denyList', rule.id, { mode: e.target.value as 'exact' | 'prefix' })}
                          >
                            <option value="exact">exact（精确匹配）</option>
                            <option value="prefix">prefix（前缀匹配）</option>
                          </UnifiedSelect>
                          <input
                            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950"
                            value={rule.value}
                            onChange={(e) => void patchCommandRule('denyList', rule.id, { value: e.target.value })}
                          />
                          <button
                            className={rule.enabled === false ? pillClass : primaryPillClass}
                            onClick={() => void patchCommandRule('denyList', rule.id, { enabled: rule.enabled === false })}
                          >
                            {rule.enabled === false ? '启用' : '停用'}
                          </button>
                          <button className={actionButtonClass} onClick={() => void removeCommandRule('denyList', rule.id)}>删除</button>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[110px_minmax(0,1fr)_100px]">
                      <UnifiedSelect
                        className="rounded-2xl px-3 py-2 pr-9 text-sm"
                        value={denyRuleDraft.mode}
                        onChange={(e) => setDenyRuleDraft((prev) => ({ ...prev, mode: e.target.value as 'exact' | 'prefix' }))}
                      >
                        <option value="exact">exact（精确匹配）</option>
                        <option value="prefix">prefix（前缀匹配）</option>
                      </UnifiedSelect>
                      <input
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                        placeholder="命令或命令前缀（可包含参数）"
                        value={denyRuleDraft.value}
                        onChange={(e) => setDenyRuleDraft((prev) => ({ ...prev, value: e.target.value }))}
                      />
                      <button className={actionButtonClass} onClick={() => void addCommandRule('denyList')}>新增</button>
                    </div>
                  </div>

                  <div className={`${cardClass} space-y-4`}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">信任与审计</div>
                      <div className="flex items-center gap-2">
                        <button
                          className={actionButtonClass}
                          onClick={async () => {
                            if (!window.intools?.shell?.clearRunCommandTrusted) return
                            await window.intools.shell.clearRunCommandTrusted()
                            await reloadSettings()
                          }}
                        >
                          清空已信任命令
                        </button>
                        <button
                          className={actionButtonClass}
                          onClick={async () => {
                            if (!window.intools?.shell?.clearRunCommandAudit) return
                            await window.intools.shell.clearRunCommandAudit()
                            await reloadSettings()
                            setCommandAudit([])
                          }}
                        >
                          清空审计
                        </button>
                        <button
                          className={actionButtonClass}
                          onClick={async () => {
                            if (!window.intools?.shell?.listRunCommandAudit) return
                            const records = await window.intools.shell.listRunCommandAudit(100)
                            setCommandAudit(records)
                          }}
                        >
                          刷新
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      已信任命令指纹：{settings.commandRunner.trustedFingerprints.length} 条
                    </div>
                    <div className="max-h-72 space-y-2 overflow-auto">
                      {(commandAudit.length > 0 ? commandAudit : [...settings.commandRunner.audit.records].reverse()).slice(0, 100).map((item) => (
                        <div key={item.id} className="rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-800 dark:text-slate-100">{item.command}</span>
                            <span className={`rounded-full px-2 py-0.5 ${item.status === 'allowed'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : item.status === 'blocked'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                : item.status === 'timeout'
                                  ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                              }`}>
                              {formatCommandAuditStatus(item.status)}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {item.source === 'plugin' ? `插件: ${item.pluginId || 'unknown'}` : '来源: 应用'}
                            {' | 退出码: '}
                            {item.exitCode ?? 'null'}
                            {' | 耗时: '}
                            {item.durationMs || 0}
                            ms
                          </div>
                          {item.reason && (
                            <div className="mt-1 text-[11px] text-red-500 dark:text-red-300">{item.reason}</div>
                          )}
                        </div>
                      ))}
                      {(commandAudit.length === 0 && settings.commandRunner.audit.records.length === 0) && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">暂无审计记录</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {section === 'developer' && settings && (
                <div className="space-y-5">
                  {/* 开发者模式开关 */}
                  <div className={`${cardClass} space-y-4`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                          启用开发者模式
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          开启后可从外部目录加载开发中的插件
                        </div>
                      </div>
                      <button
                        className={`relative w-11 h-6 rounded-full transition-colors ${settings.developer.enabled
                          ? 'bg-blue-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        onClick={() => {
                          updateSettings({
                            developer: {
                              ...settings.developer,
                              enabled: !settings.developer.enabled
                            }
                          })
                        }}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.developer.enabled ? 'translate-x-5' : ''
                            }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* 插件开发目录 */}
                  {settings.developer.enabled && (
                    <div className={`${cardClass} space-y-4`}>
                      <div className="text-sm font-medium text-slate-900 dark:text-white">
                        插件开发目录
                      </div>

                      {settings.developer.pluginPaths.length === 0 ? (
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          还没有添加任何开发目录。
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {settings.developer.pluginPaths.map((path) => (
                            <div
                              key={path}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                            >
                              <div className="truncate flex-1">
                                {path}
                              </div>
                              <button
                                className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                                onClick={async () => {
                                  await window.intools.developer.removePluginPath(path)
                                  const result = await window.intools.settings.get()
                                  setSettings(result.settings)
                                }}
                              >
                                移除
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          className={actionButtonClass}
                          onClick={async () => {
                            const path = await window.intools.developer.selectDirectory()
                            if (path) {
                              const result = await window.intools.developer.addPluginPath(path)
                              if (result.success) {
                                const settingsResult = await window.intools.settings.get()
                                setSettings(settingsResult.settings)
                              } else {
                                window.intools.notification.show(result.error || '添加失败', 'error')
                              }
                            }
                          }}
                        >
                          + 添加目录
                        </button>
                        <button
                          className={actionButtonClass}
                          onClick={async () => {
                            await window.intools.developer.reloadPlugins()
                            window.intools.notification.show('插件已刷新')
                          }}
                        >
                          刷新插件
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 调试选项 */}
                  {settings.developer.enabled && (
                    <div className={`${cardClass} space-y-4`}>
                      <div className="text-sm font-medium text-slate-900 dark:text-white">
                        调试选项
                      </div>

                      {/* 自动热重载 */}
                      <div className="flex items-center justify-between border-b border-slate-200/80 py-2 dark:border-slate-800/80">
                        <div>
                          <div className="text-sm text-slate-900 dark:text-white">
                            自动热重载
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            检测文件变化时自动重新加载插件
                          </div>
                        </div>
                        <button
                          className={`relative w-11 h-6 rounded-full transition-colors ${settings.developer.autoReload
                            ? 'bg-blue-500'
                            : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                          onClick={() => {
                            updateSettings({
                              developer: {
                                ...settings.developer,
                                autoReload: !settings.developer.autoReload
                              }
                            })
                          }}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.developer.autoReload ? 'translate-x-5' : ''
                              }`}
                          />
                        </button>
                      </div>

                      {/* 自动打开 DevTools */}
                      <div className="flex items-center justify-between border-b border-slate-200/80 py-2 dark:border-slate-800/80">
                        <div>
                          <div className="text-sm text-slate-900 dark:text-white">
                            自动打开开发者工具
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            打开插件窗口时自动打开 DevTools
                          </div>
                        </div>
                        <button
                          className={`relative w-11 h-6 rounded-full transition-colors ${settings.developer.showDevTools
                            ? 'bg-blue-500'
                            : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                          onClick={() => {
                            updateSettings({
                              developer: {
                                ...settings.developer,
                                showDevTools: !settings.developer.showDevTools
                              }
                            })
                          }}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.developer.showDevTools ? 'translate-x-5' : ''
                              }`}
                          />
                        </button>
                      </div>

                      {/* 日志级别 */}
                      <div className="py-2">
                        <div className="mb-2 text-sm text-slate-900 dark:text-white">
                          日志级别
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(['debug', 'info', 'warn', 'error'] as const).map((level) => (
                            <button
                              key={level}
                              className={settings.developer.logLevel === level ? primaryPillClass : pillClass}
                              onClick={() => {
                                updateSettings({
                                  developer: {
                                    ...settings.developer,
                                    logLevel: level
                                  }
                                })
                              }}
                            >
                              {level.charAt(0).toUpperCase() + level.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 日志查看器入口 */}
                  {settings.developer.enabled && onOpenLogViewer && (
                    <div className={`${cardClass}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-slate-900 dark:text-white">
                            开发者日志
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            查看插件日志和崩溃报告
                          </div>
                        </div>
                        <button
                          className={primaryPillClass}
                          onClick={onOpenLogViewer}
                        >
                          打开日志查看器
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 提示信息 */}
                  <div className={`${cardClass} space-y-2 text-sm text-slate-600 dark:text-slate-300`}>
                    <div className="font-medium text-slate-900 dark:text-white">使用提示</div>
                    <ul className="list-disc list-inside text-xs space-y-1">
                      <li>添加的开发目录应该包含插件文件夹（每个文件夹包含 manifest.json）</li>
                      <li>开发目录的插件将显示「开发中」标记</li>
                      <li>修改插件代码后，点击「刷新插件」或重启应用</li>
                      <li>使用 <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">npm run dev</code> 启动 Vite 开发服务器支持 UI 热重载</li>
                    </ul>
                  </div>
                </div>
              )}

              {section === 'about' && (
                <div className={`${cardClass} space-y-4 text-sm text-slate-600 dark:text-slate-300`}>
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white">应用信息</div>
                    <div>名称：{appInfo?.name}</div>
                    <div>版本：{appInfo?.version}</div>
                  </div>
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white">数据目录</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 break-all">{appInfo?.userDataPath}</div>
                  </div>
                  <button
                    className={actionButtonClass}
                    onClick={() => appInfo?.userDataPath && window.intools.shell.openFolder(appInfo.userDataPath)}
                  >
                    打开数据目录
                  </button>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export type { SettingsSection }
