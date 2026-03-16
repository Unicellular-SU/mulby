import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PluginCommandItem, PluginCommandShortcutBindingRecord } from '../../shared/types/plugin'

// 精确命令标识，用于从全部指令跳转或候选列表点选
interface CommandTarget {
  pluginId: string
  featureCode: string
  cmdId: string
}

interface CommandShortcutPanelProps {
  active: boolean
  mode: 'quick-launch' | 'all-commands'
  initialQuery?: string
  initialCommandTarget?: CommandTarget
  onInitialQueryConsumed?: () => void
  onRequestQuickLaunch?: (commandLabel: string, target: CommandTarget) => void
  onBeforeOpenCommand?: () => Promise<void> | void
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

function getBindingStateLabel(state: PluginCommandShortcutBindingRecord['state']): string {
  switch (state) {
    case 'active':
      return '已生效'
    case 'plugin-disabled':
      return '插件已禁用'
    case 'plugin-missing':
      return '插件不存在'
    case 'feature-missing':
      return '功能缺失'
    case 'command-missing':
      return '指令缺失'
    case 'command-not-bindable':
      return '不可绑定'
    case 'command-disabled':
      return '指令已禁用'
    case 'system-reserved-shortcut':
      return '系统保留快捷键'
    case 'shortcut-conflict':
      return '快捷键冲突'
    case 'invalid-shortcut':
      return '无效快捷键'
    default:
      return state
  }
}

function getMatchTypeLabel(command: PluginCommandItem): string {
  switch (command.cmdType) {
    case 'regex':
      return '正则匹配'
    case 'files':
      return '文件匹配'
    case 'img':
      return '图像匹配'
    case 'over':
      return '文本匹配'
    default:
      return '匹配规则'
  }
}

function getMatchRuleText(command: PluginCommandItem): string {
  const explain = command.explain?.trim()
  if (explain) return explain
  if (command.cmdSignature) return `签名：${command.cmdSignature}`
  return '暂无规则说明'
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

export default function CommandShortcutPanel({
  active,
  mode,
  initialQuery,
  initialCommandTarget,
  onInitialQueryConsumed,
  onRequestQuickLaunch,
  onBeforeOpenCommand
}: CommandShortcutPanelProps) {
  const [loading, setLoading] = useState(false)
  const [quickCommandInput, setQuickCommandInput] = useState('')
  const [allCommandsQuery, setAllCommandsQuery] = useState('')
  const [selectedPluginId, setSelectedPluginId] = useState('')
  const [commands, setCommands] = useState<PluginCommandItem[]>([])
  const [bindings, setBindings] = useState<PluginCommandShortcutBindingRecord[]>([])
  const [recordingCommand, setRecordingCommand] = useState<PluginCommandItem | null>(null)
  const [recordError, setRecordError] = useState('')
  const [selectedMenuCommand, setSelectedMenuCommand] = useState<PluginCommandItem | null>(null)
  // 用户从候选列表点选或从全部指令跳转时，精确锁定到某个命令
  const [pinnedCommand, setPinnedCommand] = useState<CommandTarget | null>(null)

  const loadData = useCallback(async () => {
    if (!active) return
    setLoading(true)
    try {
      const [commandRows, bindingRows] = await Promise.all([
        window.mulby.plugin.listCommands(),
        window.mulby.plugin.listCommandShortcuts()
      ])
      setCommands(commandRows)
      setBindings(bindingRows)
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    void loadData()
  }, [active, loadData])

  useEffect(() => {
    if (!active || mode !== 'quick-launch' || !initialQuery) return
    setQuickCommandInput(initialQuery)
    // 如果有精确命令标识，设置 pinnedCommand
    if (initialCommandTarget) {
      setPinnedCommand(initialCommandTarget)
    }
    onInitialQueryConsumed?.()
  }, [active, mode, initialQuery, initialCommandTarget, onInitialQueryConsumed])

  const bindingByTarget = useMemo(() => {
    const map = new Map<string, PluginCommandShortcutBindingRecord>()
    for (const binding of bindings) {
      map.set(`${binding.pluginId}:${binding.featureCode}:${binding.cmdId}`, binding)
    }
    return map
  }, [bindings])

  const bindableCommands = useMemo(
    () => commands.filter((item) => item.bindable && !item.disabled),
    [commands]
  )

  const quickMatchedCommands = useMemo(() => {
    const keyword = quickCommandInput.trim().toLowerCase()
    if (!keyword) return []
    return bindableCommands.filter((item) => {
      const haystack = [
        item.displayLabel,
        item.pluginDisplayName,
        item.pluginName,
        item.featureExplain
      ].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [bindableCommands, quickCommandInput])

  const quickExactTarget = useMemo(() => {
    const keyword = quickCommandInput.trim().toLowerCase()
    if (!keyword) return null

    // 如果有精确锁定的命令标识，优先使用
    if (pinnedCommand) {
      const pinned = quickMatchedCommands.find(
        (item) =>
          item.pluginId === pinnedCommand.pluginId &&
          item.featureCode === pinnedCommand.featureCode &&
          item.cmdId === pinnedCommand.cmdId
      )
      if (pinned) return pinned
    }

    // 当有多个候选时，不自动选中——让用户从候选列表中选择
    if (quickMatchedCommands.length > 1) return null

    // 唯一候选时，检查是否完全匹配 displayLabel
    if (quickMatchedCommands.length === 1) {
      const only = quickMatchedCommands[0]
      if (only.displayLabel.trim().toLowerCase() === keyword) return only
    }
    return null
  }, [quickMatchedCommands, quickCommandInput, pinnedCommand])

  const quickLaunchTarget = useMemo(() => {
    if (quickExactTarget) return quickExactTarget
    if (quickMatchedCommands.length === 1) return quickMatchedCommands[0]
    return null
  }, [quickExactTarget, quickMatchedCommands])

  const quickLaunchBinding = useMemo(() => {
    if (!quickLaunchTarget) return null
    return bindingByTarget.get(commandTargetKey(quickLaunchTarget)) || null
  }, [bindingByTarget, quickLaunchTarget])

  const filteredAllCommands = useMemo(() => {
    const keyword = allCommandsQuery.trim().toLowerCase()
    if (!keyword) return commands
    return commands.filter((item) => {
      const haystack = [
        item.displayLabel,
        item.pluginDisplayName,
        item.pluginName,
        item.featureExplain
      ].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [commands, allCommandsQuery])

  const pluginGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        pluginId: string
        pluginDisplayName: string
        pluginName: string
        items: PluginCommandItem[]
        launchCount: number
        matchCount: number
      }
    >()

    for (const command of filteredAllCommands) {
      const key = command.pluginId
      const existing = groups.get(key)
      if (existing) {
        existing.items.push(command)
        if (command.commandKind === 'launch') {
          existing.launchCount += 1
        } else {
          existing.matchCount += 1
        }
        continue
      }
      groups.set(key, {
        pluginId: command.pluginId,
        pluginDisplayName: command.pluginDisplayName,
        pluginName: command.pluginName,
        items: [command],
        launchCount: command.commandKind === 'launch' ? 1 : 0,
        matchCount: command.commandKind === 'launch' ? 0 : 1
      })
    }

    return Array.from(groups.values())
      .sort((a, b) => a.pluginDisplayName.localeCompare(b.pluginDisplayName))
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) => a.displayLabel.localeCompare(b.displayLabel))
      }))
  }, [filteredAllCommands])

  useEffect(() => {
    if (mode !== 'all-commands') return
    if (pluginGroups.length === 0) {
      if (selectedPluginId) {
        setSelectedPluginId('')
      }
      return
    }
    const exists = pluginGroups.some((group) => group.pluginId === selectedPluginId)
    if (!exists) {
      setSelectedPluginId(pluginGroups[0].pluginId)
    }
  }, [mode, pluginGroups, selectedPluginId])

  const selectedPluginGroup = useMemo(() => {
    if (pluginGroups.length === 0) return null
    return pluginGroups.find((group) => group.pluginId === selectedPluginId) || pluginGroups[0]
  }, [pluginGroups, selectedPluginId])

  const selectedPluginCommands = useMemo(() => {
    if (!selectedPluginGroup) return []
    return selectedPluginGroup.items
  }, [selectedPluginGroup])

  const selectedPluginLaunchCommands = useMemo(
    () => selectedPluginCommands.filter((item) => item.commandKind === 'launch'),
    [selectedPluginCommands]
  )

  const selectedPluginMatchCommands = useMemo(
    () => selectedPluginCommands.filter((item) => item.commandKind !== 'launch'),
    [selectedPluginCommands]
  )

  useEffect(() => {
    if (!recordingCommand) return

    let finished = false
    const currentCommand = recordingCommand
    void window.mulby.settings.setShortcutRecordingActive(true).catch(() => {
      // Ignore recording activation failures in view layer.
    })

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
          window.mulby.notification.show(`已绑定：${currentCommand.displayLabel} -> ${accelerator}`)
        }
        await loadData()
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
      const accelerator = parts.join('+')

      if (!mainKey || !(event.metaKey || event.ctrlKey || event.altKey)) {
        setRecordError('需要至少一个主修饰键（Command/Ctrl/Alt）')
        return
      }

      submitBinding(accelerator)
    }

    const offShortcutCaptured = window.mulby.settings.onShortcutCaptured((accelerator) => {
      submitBinding(accelerator)
    })

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      offShortcutCaptured()
      void window.mulby.settings.setShortcutRecordingActive(false).catch(() => {
        // Ignore recording deactivation failures in view layer.
      })
    }
  }, [recordingCommand, loadData])

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
  }, [])

  const clearBinding = useCallback(
    async (bindingId: string) => {
      const result = await window.mulby.plugin.unbindCommandShortcut(bindingId)
      if (!result.success) {
        window.mulby.notification.show('解绑失败', 'error')
      }
      await loadData()
    },
    [loadData]
  )

  const openCommand = useCallback(
    async (command: PluginCommandItem) => {
      if (command.commandKind !== 'launch') {
        window.mulby.notification.show('匹配指令需通过匹配输入触发，不能直接打开', 'error')
        return
      }
      await onBeforeOpenCommand?.()
      const result = await window.mulby.plugin.runCommand({
        ...buildTargetPayload(command),
        input: command.displayLabel
      })
      if (!result.success) {
        window.mulby.notification.show(result.error || '打开指令失败', 'error')
        return
      }
      window.mulby.notification.show(`已打开：${command.displayLabel}`)
      setSelectedMenuCommand(null)
    },
    [onBeforeOpenCommand]
  )

  const toggleCommandDisabled = useCallback(
    async (command: PluginCommandItem) => {
      const result = await window.mulby.plugin.setCommandDisabled({
        ...buildTargetPayload(command),
        disabled: !command.disabled
      })
      if (!result.success) {
        window.mulby.notification.show(result.error || '更新指令状态失败', 'error')
        return
      }
      window.mulby.notification.show(result.disabled ? '指令已禁用' : '指令已启用')
      setSelectedMenuCommand(null)
      await loadData()
    },
    [loadData]
  )

  const quickBindings = useMemo(
    () => bindings.filter((item) => item.cmdType === 'keyword'),
    [bindings]
  )

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900">
      <div className="space-y-1">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">插件指令</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {mode === 'quick-launch' ? '绑定快捷键直接启动指令。' : '查看并管理已安装插件的全部指令。'}
        </div>
      </div>

      {recordingCommand && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
          正在录制：{recordingCommand.displayLabel}（按 `Esc` 取消）
        </div>
      )}
      {recordError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {recordError}
        </div>
      )}

      {mode === 'quick-launch' && (
        <div className="space-y-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            手动输入指令名称并绑定快捷键。不展示全部指令，仅在你输入后匹配候选。
          </div>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            placeholder="输入指令（例如：open / 翻译）"
            value={quickCommandInput}
            onChange={(e) => {
              setPinnedCommand(null)
              setQuickCommandInput(e.target.value)
            }}
          />

          {quickLaunchTarget && (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 dark:border-slate-800/80 dark:bg-slate-950/40">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{quickLaunchTarget.displayLabel}</div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {quickLaunchTarget.pluginDisplayName} · {quickLaunchTarget.featureExplain}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    {quickLaunchBinding?.accelerator || '未设置'}
                  </div>
                  <button
                    className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    onClick={() => startRecord(quickLaunchTarget)}
                  >
                    录制快捷键
                  </button>
                  {quickLaunchBinding && (
                    <button
                      className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      onClick={() => void clearBinding(quickLaunchBinding.id)}
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {quickCommandInput.trim() && !quickLaunchTarget && quickMatchedCommands.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">匹配到多个候选，请点选目标指令：</div>
              {quickMatchedCommands.slice(0, 8).map((command) => (
                <button
                  key={`${commandTargetKey(command)}:${command.cmdSignature}`}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-left text-xs text-slate-700 transition hover:border-slate-300 dark:border-slate-800/80 dark:bg-slate-950 dark:text-slate-200"
                  onClick={() => {
                    // 锁定到用户选择的具体命令
                    setPinnedCommand({
                      pluginId: command.pluginId,
                      featureCode: command.featureCode,
                      cmdId: command.cmdId
                    })
                    setQuickCommandInput(command.displayLabel)
                  }}
                >
                  <span className="truncate">{command.displayLabel}</span>
                  <span className="truncate text-slate-500 dark:text-slate-400">{command.pluginDisplayName}</span>
                </button>
              ))}
            </div>
          )}

          {quickCommandInput.trim() && quickMatchedCommands.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              未找到可绑定的功能指令
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">已绑定快捷启动</div>
            <div className="max-h-[220px] space-y-2 overflow-auto pr-1">
              {!loading && quickBindings.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  暂无快捷启动绑定
                </div>
              )}
              {quickBindings.map((binding) => (
                <div
                  key={binding.id}
                  className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 dark:border-slate-800/80 dark:bg-slate-950/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{binding.commandLabel}</div>
                      <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {binding.pluginDisplayName || binding.pluginId} · {binding.featureExplain || binding.featureCode}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        {binding.accelerator}
                      </div>
                      <button
                        className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                        onClick={() => void clearBinding(binding.id)}
                      >
                        清除
                      </button>
                    </div>
                  </div>
                  {binding.state !== 'active' && (
                    <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                      状态：{getBindingStateLabel(binding.state)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === 'all-commands' && (
        <div className="space-y-3">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            placeholder="搜索全部指令（插件名 / 功能名 / 指令名）"
            value={allCommandsQuery}
            onChange={(e) => setAllCommandsQuery(e.target.value)}
          />

          {!loading && filteredAllCommands.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              未找到匹配指令
            </div>
          ) : (
            <div className="flex flex-col gap-3 md:h-[520px] md:flex-row">
              <aside className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-2 dark:border-slate-800/80 dark:bg-slate-950/40 md:w-48 md:shrink-0">
                <div className="px-2 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  插件列表
                </div>
                <div className="max-h-[220px] space-y-2 overflow-auto pr-1 md:max-h-[460px]">
                  {!loading && pluginGroups.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      暂无插件指令
                    </div>
                  )}
                  {pluginGroups.map((group) => {
                    const isActive = selectedPluginGroup?.pluginId === group.pluginId
                    return (
                      <button
                        key={`${group.pluginId}:${group.pluginDisplayName}`}
                        className={`w-full rounded-xl border px-3 py-2 text-left transition ${isActive
                          ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700'
                          }`}
                        onClick={() => {
                          setSelectedPluginId(group.pluginId)
                        }}
                      >
                        <div className="truncate text-xs font-semibold">{group.pluginDisplayName}</div>
                        <div className={`mt-1 text-[10px] ${isActive ? 'text-slate-100 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>
                          {group.items.length} 条指令 · 功能 {group.launchCount} · 匹配 {group.matchCount}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </aside>

              <section className="min-w-0 rounded-2xl border border-slate-200/80 bg-slate-50/40 p-3 dark:border-slate-800/80 dark:bg-slate-950/40 md:flex-1">
                {!loading && !selectedPluginGroup && (
                  <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    暂无指令
                  </div>
                )}

                {selectedPluginGroup && (
                  <div className="space-y-3 md:flex md:h-full md:flex-col md:space-y-3">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {selectedPluginGroup.pluginDisplayName}
                    </div>

                    <div className="max-h-[420px] space-y-3 overflow-auto pr-1 md:max-h-none md:flex-1">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">功能指令</div>
                        {selectedPluginLaunchCommands.length === 0 && (
                          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            暂无功能指令
                          </div>
                        )}
                        {selectedPluginLaunchCommands.map((command) => (
                          <button
                            key={`${commandTargetKey(command)}:${command.cmdSignature}`}
                            className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-left transition hover:border-slate-300 dark:border-slate-800/80 dark:bg-slate-900/70 dark:hover:border-slate-700"
                            onClick={() => setSelectedMenuCommand(command)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{command.displayLabel}</div>
                                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                                  {command.featureExplain}
                                </div>
                              </div>
                              {command.disabled && (
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                                    已禁用
                                  </span>
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">匹配指令</div>
                        {selectedPluginMatchCommands.length === 0 && (
                          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            暂无匹配指令
                          </div>
                        )}
                        {selectedPluginMatchCommands.map((command) => (
                          <button
                            key={`${commandTargetKey(command)}:${command.cmdSignature}`}
                            className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-left transition hover:border-slate-300 dark:border-slate-800/80 dark:bg-slate-900/70 dark:hover:border-slate-700"
                            onClick={() => setSelectedMenuCommand(command)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{command.displayLabel}</div>
                                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                                  {command.featureExplain}
                                </div>
                              </div>
                              {command.disabled && (
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                                    已禁用
                                  </span>
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      {selectedMenuCommand && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{selectedMenuCommand.displayLabel}</div>
              <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                {selectedMenuCommand.pluginDisplayName} · {selectedMenuCommand.featureExplain}
              </div>
            </div>
            {selectedMenuCommand.commandKind !== 'launch' && (
              <div className="mb-3 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-slate-800/80 dark:bg-slate-950/50">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  匹配规则 · {getMatchTypeLabel(selectedMenuCommand)}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {getMatchRuleText(selectedMenuCommand)}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {selectedMenuCommand.commandKind === 'launch' && (
                <button
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  onClick={() => void openCommand(selectedMenuCommand)}
                >
                  打开指令
                </button>
              )}
              {selectedMenuCommand.commandKind === 'launch' && (
                <button
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  onClick={() => {
                    onRequestQuickLaunch?.(selectedMenuCommand.displayLabel, {
                      pluginId: selectedMenuCommand.pluginId,
                      featureCode: selectedMenuCommand.featureCode,
                      cmdId: selectedMenuCommand.cmdId
                    })
                    setSelectedMenuCommand(null)
                  }}
                >
                  设置全局快捷键
                </button>
              )}
              <button
                className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-left text-sm text-red-700 transition hover:border-red-300 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                onClick={() => void toggleCommandDisabled(selectedMenuCommand)}
              >
                {selectedMenuCommand.disabled ? '启用指令' : '禁用指令'}
              </button>
              <button
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-500 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                onClick={() => setSelectedMenuCommand(null)}
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
