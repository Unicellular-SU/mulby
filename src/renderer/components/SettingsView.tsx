import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, AppShortcutAction, ShortcutStatusMap, StoreSource } from '../../shared/types/settings'

type SettingsSection =
  | 'general'
  | 'appearance'
  | 'shortcuts'
  | 'plugins'
  | 'store'
  | 'permissions'
  | 'about'

interface SettingsViewProps {
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  onClose: () => void
}

const SECTION_ITEMS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: '通用' },
  { id: 'appearance', label: '外观' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'plugins', label: '插件' },
  { id: 'store', label: '插件商店' },
  { id: 'permissions', label: '权限' },
  { id: 'about', label: '关于' }
]

const SHORTCUTS: { id: AppShortcutAction; label: string; description: string }[] = [
  { id: 'toggleWindow', label: '唤起主窗口', description: '显示或隐藏主窗口' },
  { id: 'openSettings', label: '打开设置', description: '直接进入设置面板' }
]

const PERMISSIONS = [
  { id: 'accessibility', label: '辅助功能' },
  { id: 'screen', label: '屏幕录制' },
  { id: 'microphone', label: '麦克风' },
  { id: 'camera', label: '摄像头' },
  { id: 'geolocation', label: '定位' }
]

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
    <div className="flex items-center justify-between gap-6 py-3 border-b border-gray-200/80 dark:border-gray-800/80">
      <div>
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{description}</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-[180px] text-right">
          <div className="text-sm text-gray-900 dark:text-gray-100">{displayValue}</div>
          {(error || statusText) && (
            <div className="text-xs text-red-500">{error || statusText}</div>
          )}
        </div>
        <button
          className={`px-3 py-1.5 rounded text-sm border transition-colors ${
            recording
              ? 'border-blue-500 text-blue-600 dark:text-blue-300'
              : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
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
  )
}

export default function SettingsView({ section, onSectionChange, onClose }: SettingsViewProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system')
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatusMap | null>(null)
  const [permissionStatus, setPermissionStatus] = useState<Record<string, string>>({})
  const [appInfo, setAppInfo] = useState<{ name: string; version: string; userDataPath: string } | null>(null)
  const [newSource, setNewSource] = useState<{ name: string; url: string }>({ name: '', url: '' })
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [activeRecordings, setActiveRecordings] = useState(0)

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

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden no-drag">
      <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60">
        <button
          onClick={onClose}
          className="mr-3 p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors no-drag"
          title="返回"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div>
          <div className="text-sm text-gray-500 dark:text-gray-400">设置</div>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{currentSectionLabel}</div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-48 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <nav className="py-4">
            {SECTION_ITEMS.map(item => (
              <button
                key={item.id}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  item.id === section
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/60'
                }`}
                onClick={() => onSectionChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-auto">
          <div className="max-w-3xl mx-auto px-6 py-6">
            {section === 'general' && (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                通用设置将在后续版本提供。
              </div>
            )}

            {section === 'appearance' && (
              <div className="space-y-4">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">主题模式</div>
                <div className="flex gap-3">
                  {(['light', 'dark', 'system'] as const).map((mode) => (
                    <button
                      key={mode}
                      className={`px-4 py-2 rounded border text-sm transition-colors ${
                        themeMode === mode
                          ? 'border-blue-500 text-blue-600 dark:text-blue-300'
                          : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
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
              <div>
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

            {section === 'plugins' && (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                插件管理将在下一阶段完成。
              </div>
            )}

            {section === 'store' && settings && (
              <div className="space-y-6">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">插件源</div>
                  <div className="space-y-3">
                    {sources.length === 0 && (
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        还没有添加任何插件源。
                      </div>
                    )}
                    {sources.map(source => (
                      <div
                        key={source.id}
                        className="flex items-center justify-between gap-4 px-4 py-3 rounded border border-gray-200 dark:border-gray-800"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{source.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{source.url}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            className={`px-3 py-1 rounded text-xs border ${
                              source.enabled
                                ? 'border-blue-500 text-blue-600 dark:text-blue-300'
                                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                            }`}
                            onClick={() => handleToggleSource(source.id, !source.enabled)}
                          >
                            {source.enabled ? '已启用' : '已停用'}
                          </button>
                          <button
                            className="px-3 py-1 rounded text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
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
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">新增插件源</div>
                  <div className="grid grid-cols-1 gap-3">
                    <input
                      className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                      placeholder="来源名称"
                      value={newSource.name}
                      onChange={(e) => setNewSource(prev => ({ ...prev, name: e.target.value }))}
                    />
                    <input
                      className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                      placeholder="JSON 索引地址"
                      value={newSource.url}
                      onChange={(e) => setNewSource(prev => ({ ...prev, url: e.target.value }))}
                    />
                    {sourceError && (
                      <div className="text-xs text-red-500">{sourceError}</div>
                    )}
                    <button
                      className="inline-flex items-center justify-center px-4 py-2 rounded border border-blue-500 text-blue-600 dark:text-blue-300 text-sm hover:border-blue-400"
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
                    className="flex items-center justify-between gap-4 px-4 py-3 rounded border border-gray-200 dark:border-gray-800"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {formatPermissionStatus(permissionStatus[item.id])}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="px-3 py-1 rounded text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                        onClick={() => window.intools.permission.openSystemSettings(item.id)}
                      >
                        打开系统设置
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {section === 'about' && (
              <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">应用信息</div>
                  <div>名称：{appInfo?.name}</div>
                  <div>版本：{appInfo?.version}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">数据目录</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 break-all">{appInfo?.userDataPath}</div>
                </div>
                <button
                  className="px-3 py-1 rounded text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
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
  )
}

export type { SettingsSection }
