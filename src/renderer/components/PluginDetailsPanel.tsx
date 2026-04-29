import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluginInfo } from '../../shared/types/electron'
import type {
  PluginCommandItem,
  PluginCommandShortcutBindingRecord
} from '../../shared/types/plugin'

interface PluginDetailsPanelProps {
  pluginName: string
  onClose: () => void
  onUninstall: (plugin: PluginInfo) => void
}

function normalizeShortcutKey(event: KeyboardEvent): string | null {
  const code = event.code
  const key = event.key
  if (key === 'Escape' || key === 'Dead') return null

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
  if (code in codeMap) return codeMap[code]
  if (code.startsWith('Key')) return code.slice(3).toUpperCase()
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('F')) return code
  return null
}

function commandTargetKey(command: PluginCommandItem): string {
  return `${command.pluginId}:${command.featureCode}:${command.cmdId}`
}

function buildTargetPayload(command: PluginCommandItem) {
  return {
    pluginId: command.pluginId,
    featureCode: command.featureCode,
    cmdId: command.cmdId,
    cmdSignature: command.cmdSignature
  }
}

function InfoItem({
  label,
  value,
  mono = false
}: {
  label: string
  value?: string | number | ReactNode
  mono?: boolean
}) {
  const displayValue =
    value === undefined || value === null || value === '' ? '—' : value
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      {typeof value === 'string' || typeof value === 'number' ? (
        <p
          className={`${mono ? 'font-mono text-sm' : 'text-sm'} break-words text-slate-900 dark:text-slate-100`}
        >
          {displayValue}
        </p>
      ) : (
        <div
          className={`${mono ? 'font-mono text-sm' : 'text-sm'} text-slate-900 dark:text-slate-100`}
        >
          {displayValue}
        </div>
      )}
    </div>
  )
}

function PluginIcon({
  icon,
  name,
  size = 'md'
}: {
  icon?: PluginInfo['icon']
  name: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClasses =
    size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-16 w-16' : 'h-10 w-10'
  const iconSizeClasses =
    size === 'sm'
      ? '[&>svg]:h-5 [&>svg]:w-5'
      : size === 'lg'
        ? '[&>svg]:h-10 [&>svg]:w-10'
        : '[&>svg]:h-6 [&>svg]:w-6'
  const imgSizeClasses =
    size === 'sm' ? 'h-6 w-6' : size === 'lg' ? 'h-12 w-12' : 'h-7 w-7'
  const textSizeClasses =
    size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl' : 'text-base'

  if (!icon) {
    return (
      <div
        className={`flex ${sizeClasses} items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200`}
      >
        <span className={`${textSizeClasses} font-semibold`}>
          {name.slice(0, 1).toUpperCase()}
        </span>
      </div>
    )
  }

  if (icon.type === 'svg') {
    return (
      <div
        className={`flex ${sizeClasses} items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100 ${iconSizeClasses}`}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon.value }}
      />
    )
  }

  return (
    <div
      className={`flex ${sizeClasses} items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800`}
    >
      <img
        src={icon.value}
        alt=""
        className={`${imgSizeClasses} rounded-lg object-cover`}
      />
    </div>
  )
}

export { PluginIcon }

function CommandKindBadge({ kind }: { kind: string }) {
  const isLaunch = kind === 'launch'
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] ${
        isLaunch
          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
          : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      }`}
    >
      {isLaunch ? '功能' : '匹配'}
    </span>
  )
}

export default function PluginDetailsPanel({
  pluginName,
  onClose,
  onUninstall
}: PluginDetailsPanelProps) {
  const [readme, setReadme] = useState<string | null>(null)
  const [plugin, setPlugin] = useState<PluginInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const [commands, setCommands] = useState<PluginCommandItem[]>([])
  const [bindings, setBindings] = useState<PluginCommandShortcutBindingRecord[]>([])
  const [commandMenuTarget, setCommandMenuTarget] = useState<PluginCommandItem | null>(null)
  const [recordingCommand, setRecordingCommand] = useState<PluginCommandItem | null>(null)
  const [recordError, setRecordError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const plugins = await window.mulby.plugin.getAll()
        const current = plugins.find((p) => p.name === pluginName)
        if (cancelled) return
        setPlugin(current || null)

        const content = await window.mulby.plugin.getReadme(pluginName)
        if (cancelled) return
        setReadme(content)

        if (current) {
          const [cmdRows, bindingRows] = await Promise.all([
            window.mulby.plugin.listCommands(current.id),
            window.mulby.plugin.listCommandShortcuts(current.id)
          ])
          if (cancelled) return
          setCommands(cmdRows)
          setBindings(bindingRows)
        }
      } catch (err) {
        console.error('Failed to load plugin details:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [pluginName])

  const reloadCommands = useCallback(async () => {
    if (!plugin) return
    try {
      const [cmdRows, bindingRows] = await Promise.all([
        window.mulby.plugin.listCommands(plugin.id),
        window.mulby.plugin.listCommandShortcuts(plugin.id)
      ])
      setCommands(cmdRows)
      setBindings(bindingRows)
    } catch (err) {
      console.error('Failed to reload commands:', err)
    }
  }, [plugin])

  const bindingByTarget = useMemo(() => {
    const map = new Map<string, PluginCommandShortcutBindingRecord>()
    for (const binding of bindings) {
      map.set(`${binding.pluginId}:${binding.featureCode}:${binding.cmdId}`, binding)
    }
    return map
  }, [bindings])

  const featureGroups = useMemo(() => {
    const groups = new Map<string, { featureCode: string; featureExplain: string; items: PluginCommandItem[] }>()
    for (const cmd of commands) {
      const existing = groups.get(cmd.featureCode)
      if (existing) {
        existing.items.push(cmd)
      } else {
        groups.set(cmd.featureCode, {
          featureCode: cmd.featureCode,
          featureExplain: cmd.featureExplain,
          items: [cmd]
        })
      }
    }
    return Array.from(groups.values())
  }, [commands])

  // ---------- Shortcut recording ----------

  useEffect(() => {
    if (!recordingCommand) return

    let finished = false
    const currentCommand = recordingCommand
    void window.mulby.settings.setShortcutRecordingActive(true).catch(() => {})

    const submitBinding = (accelerator: string) => {
      if (finished) return
      finished = true
      setRecordError('')
      setRecordingCommand(null)
      void (async () => {
        const result = await window.mulby.plugin.bindCommandShortcut({
          ...buildTargetPayload(currentCommand),
          commandLabel: currentCommand.displayLabel,
          accelerator
        })
        if (!result.success) {
          setRecordError(result.error || '绑定失败')
        } else {
          window.mulby.notification.show(`已绑定：${currentCommand.displayLabel} → ${accelerator}`)
        }
        await reloadCommands()
      })()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        finished = true
        setRecordingCommand(null)
        setRecordError('')
        return
      }

      const mainKey = normalizeShortcutKey(event)
      const parts: string[] = []
      if (event.metaKey || event.ctrlKey) parts.push('CommandOrControl')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      if (mainKey) parts.push(mainKey)

      if (!mainKey || !(event.metaKey || event.ctrlKey || event.altKey)) {
        setRecordError('需要至少一个主修饰键（Command/Ctrl/Alt）')
        return
      }

      submitBinding(parts.join('+'))
    }

    const offShortcutCaptured = window.mulby.settings.onShortcutCaptured((accelerator) => {
      submitBinding(accelerator)
    })

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      offShortcutCaptured()
      void window.mulby.settings.setShortcutRecordingActive(false).catch(() => {})
    }
  }, [recordingCommand, reloadCommands])

  // ---------- Command actions ----------

  const openCommand = useCallback(async (command: PluginCommandItem) => {
    if (command.commandKind !== 'launch') {
      window.mulby.notification.show('匹配指令需通过匹配输入触发，不能直接打开', 'error')
      return
    }
    const result = await window.mulby.plugin.run(
      command.pluginId,
      command.featureCode,
      command.displayLabel
    )
    if (!result.success) {
      window.mulby.notification.show(result.error || '打开指令失败', 'error')
      return
    }
    if (!result.hasUI) {
      window.mulby.notification.show(`已执行：${command.displayLabel}`)
    }
    setCommandMenuTarget(null)
  }, [])

  const startRecord = useCallback((command: PluginCommandItem) => {
    if (command.disabled) {
      setRecordError('该指令已禁用，无法设置快捷键')
      return
    }
    if (!command.bindable) {
      setRecordError('仅功能指令支持全局快捷键')
      return
    }
    setRecordError('')
    setRecordingCommand(command)
    setCommandMenuTarget(null)
  }, [])

  const clearBinding = useCallback(async (bindingId: string) => {
    const result = await window.mulby.plugin.unbindCommandShortcut(bindingId)
    if (!result.success) {
      window.mulby.notification.show('解绑失败', 'error')
    }
    await reloadCommands()
  }, [reloadCommands])

  const toggleCommandDisabled = useCallback(async (command: PluginCommandItem) => {
    const result = await window.mulby.plugin.setCommandDisabled({
      ...buildTargetPayload(command),
      disabled: !command.disabled
    })
    if (!result.success) {
      window.mulby.notification.show(result.error || '更新指令状态失败', 'error')
      return
    }
    window.mulby.notification.show(result.disabled ? '指令已禁用' : '指令已启用')
    setCommandMenuTarget(null)
    await reloadCommands()
  }, [reloadCommands])

  // ---------- Render ----------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-slate-500 dark:text-slate-400">加载中...</div>
      </div>
    )
  }

  if (!plugin) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-500">插件未找到</p>
      </div>
    )
  }

  const hasReadme = Boolean(readme && readme.trim().length > 0)

  return (
    <div className="flex h-full flex-col bg-white/50 dark:bg-slate-900/30">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
          aria-label="关闭详情"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            {plugin.displayName}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {plugin.enabled ? '已启用' : '未启用'}
          </span>
          {plugin.builtin && (
            <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              内置
            </span>
          )}
          <button
            onClick={() => {
              onUninstall(plugin)
              onClose()
            }}
            disabled={plugin.builtin}
            className="rounded-full border border-transparent px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            卸载
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pb-8 pt-6">
          {/* Plugin info card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900">
            <div className="flex items-start gap-4">
              <PluginIcon icon={plugin.icon} name={plugin.displayName} size="lg" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
                    {plugin.displayName}
                  </h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    v{plugin.version || '0.0.0'}
                  </span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {plugin.description || '暂无简介'}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                    {commands.length} 条指令
                  </span>
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                    {bindings.length} 个快捷键
                  </span>
                  {plugin.homepage && (
                    <a
                      href={plugin.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-white"
                    >
                      官方主页
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <InfoItem label="插件名称" value={plugin.name} mono />
              <InfoItem label="唯一标识" value={plugin.id} mono />
              <InfoItem label="作者" value={plugin.author || '未知'} />
              <InfoItem
                label="主页"
                value={
                  plugin.homepage ? (
                    <a
                      className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                      href={plugin.homepage}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {plugin.homepage}
                    </a>
                  ) : (
                    '—'
                  )
                }
              />
            </div>
          </div>

          {/* Recording overlay */}
          {recordingCommand && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-950/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    正在录制快捷键：{recordingCommand.displayLabel}
                  </div>
                  <div className="mt-0.5 text-xs text-blue-600 dark:text-blue-300">
                    请按下快捷键组合（需包含 Command/Ctrl/Alt），按 Esc 取消
                  </div>
                </div>
                <button
                  onClick={() => {
                    setRecordingCommand(null)
                    setRecordError('')
                  }}
                  className="rounded-full border border-blue-200 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {recordError && !recordingCommand && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
              {recordError}
            </div>
          )}

          {/* Commands section */}
          <div className="mt-6">
            <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              功能与命令
            </h4>

            {featureGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                此插件暂无指令
              </div>
            ) : (
              <div className="space-y-3">
                {featureGroups.map((group) => {
                  const feature = plugin.features.find((f) => f.code === group.featureCode)
                  return (
                    <div
                      key={group.featureCode}
                      className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900"
                    >
                      <div className="flex items-center gap-2">
                        {feature?.icon && feature.icon.type && feature.icon.value && (
                          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
                            {feature.icon.type === 'svg' ? (
                              <div
                                className="h-3 w-3 [&>svg]:h-3 [&>svg]:w-3"
                                dangerouslySetInnerHTML={{ __html: feature.icon.value }}
                              />
                            ) : feature.icon.type === 'emoji' ? (
                              <span className="text-xs leading-none">{feature.icon.value}</span>
                            ) : (
                              <img
                                src={feature.icon.value}
                                alt=""
                                className="h-3 w-3 object-contain"
                              />
                            )}
                          </div>
                        )}
                        <h5 className="text-sm font-semibold text-slate-900 dark:text-white">
                          {group.featureExplain}
                        </h5>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                          {group.featureCode}
                        </span>
                        {feature?.mode && (
                          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                            {feature.mode}
                          </span>
                        )}
                      </div>

                      <div className="mt-3 space-y-2">
                        {group.items.map((cmd) => {
                          const binding = bindingByTarget.get(commandTargetKey(cmd))
                          return (
                            <div
                              key={`${cmd.featureCode}-${cmd.cmdId}`}
                              className="group flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 transition hover:border-slate-200 dark:border-slate-800/60 dark:bg-slate-950/40 dark:hover:border-slate-700"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <CommandKindBadge kind={cmd.commandKind} />
                                <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                  {cmd.displayLabel}
                                </span>
                                {cmd.disabled && (
                                  <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                                    已禁用
                                  </span>
                                )}
                                {binding && (
                                  <span className="shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                                    {binding.accelerator}
                                  </span>
                                )}
                              </div>

                              {/* Action buttons */}
                              <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                                {cmd.commandKind === 'launch' && !cmd.disabled && (
                                  <button
                                    onClick={() => void openCommand(cmd)}
                                    className="rounded-md px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                                    title="打开指令"
                                  >
                                    打开
                                  </button>
                                )}
                                {cmd.commandKind === 'launch' && cmd.bindable && !cmd.disabled && (
                                  binding ? (
                                    <button
                                      onClick={() => void clearBinding(binding.id)}
                                      className="rounded-md px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                                      title="清除快捷键"
                                    >
                                      清除快捷键
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => startRecord(cmd)}
                                      className="rounded-md px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                                      title="设置全局快捷键"
                                    >
                                      快捷键
                                    </button>
                                  )
                                )}
                                <button
                                  onClick={() => void toggleCommandDisabled(cmd)}
                                  className={`rounded-md px-2 py-1 text-[11px] transition ${
                                    cmd.disabled
                                      ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30'
                                      : 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
                                  }`}
                                  title={cmd.disabled ? '启用指令' : '禁用指令'}
                                >
                                  {cmd.disabled ? '启用' : '禁用'}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* README */}
          {hasReadme && (
            <div className="mt-6">
              <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                README 文档
              </h4>
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900">
                <article className="prose prose-sm prose-slate max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme || ''}</ReactMarkdown>
                </article>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Command action menu modal */}
      {commandMenuTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                {commandMenuTarget.displayLabel}
              </div>
              <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                {commandMenuTarget.featureExplain}
              </div>
            </div>
            <div className="space-y-2">
              {commandMenuTarget.commandKind === 'launch' && (
                <button
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  onClick={() => void openCommand(commandMenuTarget)}
                >
                  打开指令
                </button>
              )}
              {commandMenuTarget.commandKind === 'launch' && commandMenuTarget.bindable && (
                <button
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  onClick={() => startRecord(commandMenuTarget)}
                >
                  设置全局快捷键
                </button>
              )}
              <button
                className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-left text-sm text-red-700 transition hover:border-red-300 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                onClick={() => void toggleCommandDisabled(commandMenuTarget)}
              >
                {commandMenuTarget.disabled ? '启用指令' : '禁用指令'}
              </button>
              <button
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-500 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                onClick={() => setCommandMenuTarget(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
