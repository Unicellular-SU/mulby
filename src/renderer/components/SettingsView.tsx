import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, AppShortcutAction, ShortcutStatusMap, StoreSource } from '../../shared/types/settings'
type SettingsSection =
  | 'general'
  | 'appearance'
  | 'shortcuts'
  | 'store'
  | 'permissions'
  | 'developer'
  | 'about'

interface SettingsViewProps {
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  onClose: () => void
  onOpenPluginManager: () => void
  onOpenBackgroundPluginManager?: () => void
  onOpenLogViewer?: () => void
}

const SECTION_ITEMS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: '通用' },
  { id: 'appearance', label: '外观' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'store', label: '插件商店' },
  { id: 'permissions', label: '权限' },
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
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/70 sm:p-5">
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

export default function SettingsView({ section, onSectionChange, onClose, onOpenPluginManager, onOpenBackgroundPluginManager, onOpenLogViewer }: SettingsViewProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system')
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatusMap | null>(null)
  const [permissionStatus, setPermissionStatus] = useState<Record<string, string>>({})
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

  const sources = settings?.storeSources ?? []

  const updateSettings = async (partial: Partial<AppSettings>) => {
    const result = await window.intools.settings.update(partial)
    setSettings(result.settings)
    setShortcutStatus(result.shortcutStatus)
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
  const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white/80 p-6 backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/70'
  const cardClassTight = 'rounded-[24px] border border-slate-200/80 bg-white/80 p-5 backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/70'
  const pillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white'
  const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'

  return (
    <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 no-drag">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-500/20" />
        <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-[120px] dark:bg-emerald-400/10" />
        <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-indigo-200/30 blur-[120px] dark:bg-indigo-500/10" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white/70 px-6 py-4 backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/60">
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
            <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Settings</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{currentSectionLabel}</div>
          </div>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          <aside className="w-56 shrink-0 border-r border-slate-200/70 bg-white/70 backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/60">
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

          <main className="flex-1 min-h-0 overflow-auto">
            <div className="mx-auto max-w-5xl px-6 pb-16 pt-8">
              {section === 'general' && (
                <div className="space-y-4">
                  <div className={`${cardClass} text-sm text-slate-600 dark:text-slate-300`}>
                    通用设置将在后续版本提供。
                  </div>
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
