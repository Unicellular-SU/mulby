import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
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
import SuperPanelSection from './settings/sections/SuperPanelSection'
import DeveloperSection from './settings/sections/DeveloperSection'
import OpenClawSection from './settings/sections/OpenClawSection'
import type { SettingsViewProps } from './settings/types'
import { PERMISSIONS, SECTION_ITEMS } from './settings/constants'

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
  onOpenStorageExplorer,
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
  const [inlineShortcutCommandHint, setInlineShortcutCommandHint] = useState('')
  const [inlineShortcutCommandTarget, setInlineShortcutCommandTarget] = useState<{
    pluginId: string
    featureCode: string
    cmdId: string
  } | null>(null)
  const [appInfo, setAppInfo] = useState<{ name: string; version: string; userDataPath: string } | null>(null)
  const [openAtLoginState, setOpenAtLoginState] = useState<StartupOpenAtLoginState>({ supported: false, enabled: false })
  const [updateCenterState, setUpdateCenterState] = useState<UpdateCenterState | null>(null)
  const [startupBusy, setStartupBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [activeRecordings, setActiveRecordings] = useState(0)
  const [mainPushPlugins, setMainPushPlugins] = useState<Array<{ pluginId: string; displayName: string }>>([])

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
    window.mulby.plugin.getMainPushPlugins().then(setMainPushPlugins).catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      void window.mulby.settings.resumeShortcuts().catch(() => {
        // Ignore resume failures during settings cleanup.
      })
    }
  }, [])

  useEffect(() => {
    if (section === 'general' || section === 'superPanel') return
    if (activeRecordings <= 0) return
    setActiveRecordings(0)
    void window.mulby.settings.resumeShortcuts().then(setShortcutStatus).catch(() => {
      // 离开可录制快捷键的设置页时恢复快捷键
    })
  }, [activeRecordings, section])

  // 加载所有权限状态
  const loadPermissions = useCallback(async () => {
    const next: Record<string, string> = {}
    for (const item of PERMISSIONS) {
      next[item.id] = await window.mulby.permission.getStatus(item.id)
    }
    setPermissionStatus(next)
  }, [])

  useEffect(() => {
    if (section !== 'permissions') return
    void loadPermissions()
  }, [section, loadPermissions])

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

  const downloadUpdate = async () => {
    if (updateBusy) return
    setUpdateBusy(true)
    try {
      await window.mulby.settings.downloadUpdate()
    } catch (error) {
      notice.error(error instanceof Error ? error.message : '下载更新失败')
    } finally {
      setUpdateBusy(false)
    }
  }

  const installUpdate = () => {
    void window.mulby.settings.installUpdate()
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

  // 监听 autoUpdater 推送的状态变化（实时进度等）
  useEffect(() => {
    const unsub = window.mulby.settings.onUpdateStateChanged((state) => {
      setUpdateCenterState(state)
    })
    return unsub
  }, [])

  // 监听主进程推送的快捷键状态变化（后台重试成功时触发）
  useEffect(() => {
    const unsub = window.mulby.settings.onShortcutStatusChanged((status) => {
      setShortcutStatus(status)
    })
    return unsub
  }, [])

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
                  onOpenStorageExplorer={onOpenStorageExplorer}
                  onNavigateTo={(s) => onSectionChange(s as typeof section)}
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
                  searchSettings={settings?.search ?? { enableApps: true, enableFiles: false, enableMainPush: true, disabledMainPushPlugins: [] }}
                  mainPushPlugins={mainPushPlugins}
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
                  onMouseTriggerChange={async (patch) => {
                    if (!settings) return
                    await updateSettings({
                      mouseTrigger: {
                        ...settings.mouseTrigger,
                        ...patch
                      }
                    })
                  }}
                  onDoubleTapChange={async (patch) => {
                    if (!settings) return
                    await updateSettings({
                      doubleTap: {
                        ...settings.doubleTap,
                        ...patch
                      }
                    })
                  }}
                  cardClass={cardClass}
                />
              )}

              {section === 'superPanel' && settings && (
                <SuperPanelSection
                  settings={settings}
                  updateSettings={updateSettings}
                  cardClass={cardClass}
                  onRecordStart={handleRecordStart}
                  onRecordEnd={handleRecordEnd}
                />
              )}

              {section === 'commandQuickLaunch' && (
                <CommandShortcutPanel
                  active={section === 'commandQuickLaunch'}
                  mode="quick-launch"
                  cardClass={cardClass}
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
                  cardClass={cardClass}
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
                  onRefresh={loadPermissions}
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
                  reloadSettings={reloadSettings}
                  updateCommandRunner={updateCommandRunner}
                  addCommandRule={addCommandRule}
                  removeCommandRule={removeCommandRule}
                  patchCommandRule={patchCommandRule}
                  cardClass={cardClass}
                  actionButtonClass={actionButtonClass}
                  pillClass={pillClass}
                  primaryPillClass={primaryPillClass}
                />
              )}

              {section === 'openclaw' && settings && (
                <OpenClawSection
                  cardClass={cardClass}
                  actionButtonClass={actionButtonClass}
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
                  onDownloadUpdate={downloadUpdate}
                  onInstallUpdate={installUpdate}
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
