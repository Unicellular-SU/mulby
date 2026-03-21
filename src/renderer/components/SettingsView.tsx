import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  AiToolCapabilityGrant,
  AppShortcutAction,
  CommandAuditItem,
  CommandRule,
  ShortcutStatusMap
} from '../../shared/types/settings'
import type { StartupOpenAtLoginState, UpdateCenterState } from '../../shared/types/electron'
import { useInAppNotice } from './InAppNotice'
import CommandShortcutPanel from './CommandShortcutPanel'
import DashboardSection from './settings/sections/DashboardSection'
import GeneralSection from './settings/sections/GeneralSection'
import PermissionsSection from './settings/sections/PermissionsSection'
import AboutSection from './settings/sections/AboutSection'
import SecuritySection from './settings/sections/SecuritySection'
import DeveloperSection from './settings/sections/DeveloperSection'
import type { SettingsViewProps } from './settings/types'
import { DEFAULT_APP_CAPABILITIES, PERMISSIONS, SECTION_ITEMS } from './settings/constants'
import { parseListDraft } from './settings/utils'

export default function SettingsView({
  section,
  shortcutCommandHint,
  onShortcutCommandHintConsumed,
  onPrepareCommandLaunch,
  onSectionChange,
  onClose,
  onOpenPluginManager,
  onOpenBackgroundPluginManager,
  onOpenTaskScheduler,
  onOpenLogViewer,
  onOpenAiSettings
}: SettingsViewProps) {
  const notice = useInAppNotice()
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
  const [inlineShortcutCommandHint, setInlineShortcutCommandHint] = useState('')
  const [inlineShortcutCommandTarget, setInlineShortcutCommandTarget] = useState<{
    pluginId: string
    featureCode: string
    cmdId: string
  } | null>(null)
  const [runScriptDraft, setRunScriptDraft] = useState({
    id: '',
    command: '',
    args: '',
    cwd: '',
    timeoutMs: '',
    allowEnvKeys: ''
  })
  const [appInfo, setAppInfo] = useState<{ name: string; version: string; userDataPath: string } | null>(null)
  const [openAtLoginState, setOpenAtLoginState] = useState<StartupOpenAtLoginState>({ supported: false, enabled: false })
  const [updateCenterState, setUpdateCenterState] = useState<UpdateCenterState | null>(null)
  const [startupBusy, setStartupBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [activeRecordings, setActiveRecordings] = useState(0)

  useEffect(() => {
    window.mulby.settings.get().then(({ settings, shortcutStatus }) => {
      setSettings(settings)
      setShortcutStatus(shortcutStatus)
    })
    window.mulby.theme.get().then((info) => setThemeMode(info.mode))
    window.mulby.system.getAppInfo().then((info) => {
      setAppInfo({ name: info.name, version: info.version, userDataPath: info.userDataPath })
    })
    window.mulby.settings.getOpenAtLoginState().then((state) => {
      setOpenAtLoginState(state)
    }).catch(() => {
      setOpenAtLoginState({ supported: false, enabled: false })
    })
    window.mulby.settings.getUpdateCenterState().then((state) => {
      setUpdateCenterState(state)
    }).catch(() => {
      setUpdateCenterState(null)
    })
  }, [])

  useEffect(() => {
    return () => {
      void window.mulby.settings.resumeShortcuts().catch(() => {
        // Ignore resume failures during settings cleanup.
      })
    }
  }, [])

  useEffect(() => {
    if (section === 'general') return
    if (activeRecordings <= 0) return
    setActiveRecordings(0)
    void window.mulby.settings.resumeShortcuts().then(setShortcutStatus).catch(() => {
      // 离开通用设置页时恢复快捷键
    })
  }, [activeRecordings, section])

  useEffect(() => {
    if (section !== 'permissions') return
    const load = async () => {
      const next: Record<string, string> = {}
      for (const item of PERMISSIONS) {
        next[item.id] = await window.mulby.permission.getStatus(item.id)
      }
      setPermissionStatus(next)
    }
    void load()
  }, [section])

  useEffect(() => {
    if (section !== 'security') return
    const loadAudit = async () => {
      if (!window.mulby?.shell?.listRunCommandAudit) {
        setCommandAudit([])
        return
      }
      try {
        const records = await window.mulby.shell.listRunCommandAudit(100)
        setCommandAudit(records)
      } catch {
        setCommandAudit([])
      }
    }
    void loadAudit()
  }, [section, settings?.commandRunner.audit.records.length])

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
    const result = await window.mulby.settings.update(partial)
    setSettings(result.settings)
    setShortcutStatus(result.shortcutStatus)
  }

  const reloadSettings = async () => {
    const result = await window.mulby.settings.get()
    setSettings(result.settings)
    setShortcutStatus(result.shortcutStatus)
  }

  const reloadStartupAndUpdateState = async () => {
    const [startupState, updateState] = await Promise.all([
      window.mulby.settings.getOpenAtLoginState(),
      window.mulby.settings.getUpdateCenterState()
    ])
    setOpenAtLoginState(startupState)
    setUpdateCenterState(updateState)
  }

  const toggleOpenAtLogin = async () => {
    if (!openAtLoginState.supported || startupBusy) return
    setStartupBusy(true)
    try {
      const next = await window.mulby.settings.setOpenAtLogin(!openAtLoginState.enabled)
      setOpenAtLoginState(next)
      notice.success(next.enabled ? '已开启开机自启动' : '已关闭开机自启动')
    } catch (error) {
      notice.error(error instanceof Error ? error.message : '设置开机自启动失败')
    } finally {
      setStartupBusy(false)
    }
  }

  const checkAppUpdates = async () => {
    if (updateBusy) return
    setUpdateBusy(true)
    try {
      const next = await window.mulby.settings.checkAppUpdates()
      setUpdateCenterState(next)
      if (next.status === 'update-available') {
        notice.success(next.message || '发现新版本')
      } else if (next.status === 'up-to-date') {
        notice.success(next.message || '当前已是最新版本')
      } else if (next.status === 'error') {
        notice.error(next.message || '更新检查失败')
      }
    } catch (error) {
      notice.error(error instanceof Error ? error.message : '更新检查失败')
    } finally {
      setUpdateBusy(false)
    }
  }

  const openUpdateReleasePage = async () => {
    try {
      const ok = await window.mulby.settings.openUpdateReleasePage()
      if (!ok) {
        notice.error('发布页地址不可用，请检查更新中心配置')
      }
    } catch (error) {
      notice.error(error instanceof Error ? error.message : '打开发布页失败')
    }
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
        void window.mulby.settings.pauseShortcuts().catch(() => {
          // Ignore pause failures in view layer.
        })
      }
      return next
    })
  }

  const handleRecordEnd = async () => {
    setActiveRecordings((count) => {
      const next = Math.max(0, count - 1)
      if (next === 0) {
        void window.mulby.settings.resumeShortcuts().then(setShortcutStatus).catch(() => {
          // Ignore resume failures in view layer.
        })
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

  useEffect(() => {
    if (section !== 'general' && section !== 'about') return
    void reloadStartupAndUpdateState().catch(() => {
      // ignore refresh errors in view layer
    })
  }, [section])

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
              {section === 'dashboard' && (
                <DashboardSection
                  onOpenAiSettings={onOpenAiSettings}
                  onOpenPluginManager={onOpenPluginManager}
                  onOpenBackgroundPluginManager={onOpenBackgroundPluginManager}
                  onOpenTaskScheduler={onOpenTaskScheduler}
                  cardClass={cardClass}
                  primaryPillClass={primaryPillClass}
                />
              )}

              {section === 'general' && (
                <GeneralSection
                  themeMode={themeMode}
                  onThemeModeChange={async (mode) => {
                    const info = await window.mulby.theme.set(mode)
                    setThemeMode(info.mode)
                  }}
                  openAtLoginState={openAtLoginState}
                  startupBusy={startupBusy}
                  onToggleOpenAtLogin={toggleOpenAtLogin}
                  searchSettings={settings?.search ?? { enableApps: true, enableFiles: false }}
                  onSearchSettingsChange={async (patch) => {
                    if (!settings) return
                    await updateSettings({
                      search: {
                        ...settings.search,
                        ...patch
                      }
                    })
                  }}
                  settings={settings}
                  shortcutStatus={shortcutStatus}
                  onShortcutChange={handleShortcutChange}
                  onRecordStart={handleRecordStart}
                  onRecordEnd={handleRecordEnd}
                  cardClass={cardClass}
                />
              )}



              {section === 'commandQuickLaunch' && (
                <CommandShortcutPanel
                  active={section === 'commandQuickLaunch'}
                  mode="quick-launch"
                  initialQuery={inlineShortcutCommandHint || shortcutCommandHint}
                  initialCommandTarget={inlineShortcutCommandTarget || undefined}
                  onInitialQueryConsumed={() => {
                    setInlineShortcutCommandHint('')
                    setInlineShortcutCommandTarget(null)
                    onShortcutCommandHintConsumed?.()
                  }}
                />
              )}

              {section === 'commandAll' && (
                <CommandShortcutPanel
                  active={section === 'commandAll'}
                  mode="all-commands"
                  onBeforeOpenCommand={onPrepareCommandLaunch}
                  onRequestQuickLaunch={(commandLabel, target) => {
                    setInlineShortcutCommandHint(commandLabel)
                    setInlineShortcutCommandTarget(target)
                    onSectionChange('commandQuickLaunch')
                  }}
                />
              )}

              {section === 'permissions' && (
                <PermissionsSection
                  permissionStatus={permissionStatus}
                  cardClassTight={cardClassTight}
                  actionButtonClass={actionButtonClass}
                />
              )}

              {section === 'security' && settings && (
                <SecuritySection
                  settings={settings}
                  commandAudit={commandAudit}
                  setCommandAudit={setCommandAudit}
                  allowRuleDraft={allowRuleDraft}
                  setAllowRuleDraft={setAllowRuleDraft}
                  denyRuleDraft={denyRuleDraft}
                  setDenyRuleDraft={setDenyRuleDraft}
                  filesystemRootDraft={filesystemRootDraft}
                  setFilesystemRootDraft={setFilesystemRootDraft}
                  patchRootDraft={patchRootDraft}
                  setPatchRootDraft={setPatchRootDraft}
                  gitRootDraft={gitRootDraft}
                  setGitRootDraft={setGitRootDraft}
                  denyHostDraft={denyHostDraft}
                  setDenyHostDraft={setDenyHostDraft}
                  denyCidrDraft={denyCidrDraft}
                  setDenyCidrDraft={setDenyCidrDraft}
                  denyPrefixDraft={denyPrefixDraft}
                  setDenyPrefixDraft={setDenyPrefixDraft}
                  appCapabilityDraft={appCapabilityDraft}
                  setAppCapabilityDraft={setAppCapabilityDraft}
                  grantDraft={grantDraft}
                  setGrantDraft={setGrantDraft}
                  runScriptDraft={runScriptDraft}
                  setRunScriptDraft={setRunScriptDraft}
                  visibleCapabilityGrants={visibleCapabilityGrants}
                  isDefaultAppCapabilitiesAtDefault={isDefaultAppCapabilitiesAtDefault}
                  reloadSettings={reloadSettings}
                  updateCommandRunner={updateCommandRunner}
                  updateAiTooling={updateAiTooling}
                  updateAiFilesystem={updateAiFilesystem}
                  updateAiHttp={updateAiHttp}
                  updateAiRunScript={updateAiRunScript}
                  restoreDefaultAppCapabilities={restoreDefaultAppCapabilities}
                  removeCapabilityFromPolicyList={removeCapabilityFromPolicyList}
                  addCapabilityToPolicyList={addCapabilityToPolicyList}
                  addCapabilityGrant={addCapabilityGrant}
                  removeCapabilityGrant={removeCapabilityGrant}
                  patchCapabilityGrant={patchCapabilityGrant}
                  addFilesystemRoot={addFilesystemRoot}
                  removeFilesystemRoot={removeFilesystemRoot}
                  addPatchRoot={addPatchRoot}
                  removePatchRoot={removePatchRoot}
                  addGitRoot={addGitRoot}
                  removeGitRoot={removeGitRoot}
                  addHttpDenyHost={addHttpDenyHost}
                  removeHttpDenyHost={removeHttpDenyHost}
                  addHttpDenyCidr={addHttpDenyCidr}
                  removeHttpDenyCidr={removeHttpDenyCidr}
                  addHttpDenyPrefix={addHttpDenyPrefix}
                  removeHttpDenyPrefix={removeHttpDenyPrefix}
                  updateRunScriptEntry={updateRunScriptEntry}
                  removeRunScriptEntry={removeRunScriptEntry}
                  addRunScriptEntry={addRunScriptEntry}
                  addCommandRule={addCommandRule}
                  removeCommandRule={removeCommandRule}
                  patchCommandRule={patchCommandRule}
                  cardClass={cardClass}
                  actionButtonClass={actionButtonClass}
                  pillClass={pillClass}
                  primaryPillClass={primaryPillClass}
                />
              )}

              {section === 'developer' && settings && (
                <DeveloperSection
                  settings={settings}
                  setSettings={setSettings}
                  updateSettings={updateSettings}
                  notice={notice}
                  onOpenLogViewer={onOpenLogViewer}
                  cardClass={cardClass}
                  actionButtonClass={actionButtonClass}
                  pillClass={pillClass}
                  primaryPillClass={primaryPillClass}
                />
              )}


              {section === 'about' && (
                <AboutSection
                  appInfo={appInfo}
                  updateCenterState={updateCenterState}
                  updateBusy={updateBusy}
                  onCheckAppUpdates={checkAppUpdates}
                  onOpenUpdateReleasePage={openUpdateReleasePage}
                  cardClass={cardClass}
                  primaryPillClass={primaryPillClass}
                  actionButtonClass={actionButtonClass}
                />
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export type { SettingsSection } from './settings/types'
