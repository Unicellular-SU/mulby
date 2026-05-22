import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Bolt, CheckCircle2, Keyboard, Play, Search, Tag, X } from 'lucide-react'
import {
  buildAcceleratorFromKeyboardEvent,
  formatAcceleratorForPlatform
} from '../../shared/shortcut-accelerator'
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
  cardClass: string
  initialQuery?: string
  initialCommandTarget?: CommandTarget
  onInitialQueryConsumed?: () => void
  onRequestQuickLaunch?: (commandLabel: string, target: CommandTarget) => void
  onBeforeOpenCommand?: () => Promise<void> | void
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

function getCommandTypeLabel(command: PluginCommandItem): string {
  return command.commandKind === 'launch' ? '功能' : '匹配'
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
  cardClass,
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
          window.mulby.notification.show(`已绑定：${currentCommand.displayLabel} -> ${formatAcceleratorForPlatform(accelerator)}`)
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

      const result = buildAcceleratorFromKeyboardEvent(event)
      if (result.error) {
        setRecordError(result.error)
        return
      }

      submitBinding(result.accelerator)
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

  const renderCommandStatusBadges = (command: PluginCommandItem) => {
    const binding = bindingByTarget.get(commandTargetKey(command))
    return (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${command.commandKind === 'launch'
          ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300'
          : 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300'
          }`}>
          <Tag className="h-3 w-3" />
          {getCommandTypeLabel(command)}
        </span>
        {binding && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
            title={formatAcceleratorForPlatform(binding.accelerator)}
          >
            <Keyboard className="h-3 w-3" />
            已绑定
          </span>
        )}
        {command.disabled && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <Ban className="h-3 w-3" />
            已禁用
          </span>
        )}
      </div>
    )
  }

  const renderCommandCard = (command: PluginCommandItem) => {
    const binding = bindingByTarget.get(commandTargetKey(command))
    return (
      <button
        key={`${commandTargetKey(command)}:${command.cmdSignature}`}
        className="group w-full border-b border-slate-200/70 px-3 py-3 text-left transition hover:bg-slate-100/70 last:border-b-0 dark:border-slate-800/80 dark:hover:bg-slate-900/70"
        onClick={() => setSelectedMenuCommand(command)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{command.displayLabel}</div>
            <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
              {command.featureExplain || command.featureCode}
            </div>
            {binding && (
              <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                <Keyboard className="h-3 w-3 shrink-0" />
                <span className="truncate">{formatAcceleratorForPlatform(binding.accelerator)}</span>
              </div>
            )}
          </div>
          {renderCommandStatusBadges(command)}
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-5">
      <div className={`${cardClass} flex items-start justify-between gap-4`}>
        <div className="space-y-1">
          <div className="text-sm font-medium text-slate-900 dark:text-white">插件指令</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {mode === 'quick-launch' ? '绑定快捷键直接启动指令。' : '查看并管理已安装插件的全部指令。'}
          </div>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {loading ? '加载中...' : `${commands.length} 条指令`}
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
        <>
        <div className={`${cardClass} space-y-4`}>
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">绑定指令快捷键</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              手动输入指令名称并绑定快捷键。不展示全部指令，仅在你输入后匹配候选。
            </div>
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
                    {quickLaunchBinding?.accelerator ? formatAcceleratorForPlatform(quickLaunchBinding.accelerator) : '未设置'}
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
        </div>

          <div className={`${cardClass} space-y-3`}>
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">已绑定快捷启动</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                管理已经注册为全局快捷键的插件指令。
              </div>
            </div>
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
                        {formatAcceleratorForPlatform(binding.accelerator)}
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
        </>
      )}

      {mode === 'all-commands' && (
        <div className={`${cardClass} space-y-4`}>
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">指令管理</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              按插件浏览功能指令和匹配指令，可打开、禁用或设置全局快捷键。
            </div>
          </div>
          <label className="flex items-center gap-2 border-b border-slate-200/80 bg-transparent px-1 py-3 text-sm text-slate-700 transition focus-within:border-slate-400 dark:border-slate-800/80 dark:text-slate-200 dark:focus-within:border-slate-600">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
              placeholder="搜索全部指令（插件名 / 功能名 / 指令名）"
              value={allCommandsQuery}
              onChange={(e) => setAllCommandsQuery(e.target.value)}
            />
          </label>

          {!loading && filteredAllCommands.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              未找到匹配指令
            </div>
          ) : (
            <div className="flex flex-col gap-5 md:min-h-[520px] md:flex-row md:gap-0">
              <aside className="md:w-56 md:shrink-0 md:border-r md:border-slate-200/80 md:pr-4 dark:md:border-slate-800/80">
                <div className="flex items-center justify-between px-1 pb-3 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <span>插件列表</span>
                  <span className="font-normal text-slate-400">{pluginGroups.length}</span>
                </div>
                <div className="space-y-1 overflow-auto pr-1 md:max-h-[calc(100vh-300px)]">
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
                        className={`w-full rounded-xl px-3 py-2.5 text-left transition ${isActive
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/70'
                          }`}
                        onClick={() => {
                          setSelectedPluginId(group.pluginId)
                        }}
                      >
                        <div className="truncate text-xs font-semibold">{group.pluginDisplayName}</div>
                        <div className={`mt-1 text-[11px] ${isActive ? 'text-slate-100 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>
                          {group.items.length} 条指令 · 功能 {group.launchCount} · 匹配 {group.matchCount}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </aside>

              <section className="min-w-0 md:flex-1 md:pl-5">
                {!loading && !selectedPluginGroup && (
                  <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    暂无指令
                  </div>
                )}

                {selectedPluginGroup && (
                  <div className="space-y-4 md:flex md:h-full md:flex-col">
                    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200/80 pb-3 dark:border-slate-800/80">
                      <div>
                        <div className="text-base font-semibold text-slate-900 dark:text-white">
                          {selectedPluginGroup.pluginDisplayName}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {selectedPluginGroup.pluginName}
                        </div>
                      </div>
                      <div className="flex gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-900">
                          功能 {selectedPluginGroup.launchCount}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-900">
                          匹配 {selectedPluginGroup.matchCount}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-6 overflow-auto pr-1 md:max-h-[calc(100vh-330px)] md:flex-1">
                      <div>
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          <Bolt className="h-3.5 w-3.5" />
                          功能指令
                        </div>
                        {selectedPluginLaunchCommands.length === 0 && (
                          <div className="mt-2 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            暂无功能指令
                          </div>
                        )}
                        {selectedPluginLaunchCommands.length > 0 && (
                          <div className="mt-2 divide-y-0 overflow-hidden border-y border-slate-200/70 dark:border-slate-800/80">
                            {selectedPluginLaunchCommands.map(renderCommandCard)}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          <Search className="h-3.5 w-3.5" />
                          匹配指令
                        </div>
                        {selectedPluginMatchCommands.length === 0 && (
                          <div className="mt-2 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            暂无匹配指令
                          </div>
                        )}
                        {selectedPluginMatchCommands.length > 0 && (
                          <div className="mt-2 overflow-hidden border-y border-slate-200/70 dark:border-slate-800/80">
                            {selectedPluginMatchCommands.map(renderCommandCard)}
                          </div>
                        )}
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
          <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-slate-900 dark:text-white">{selectedMenuCommand.displayLabel}</div>
                <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                  {selectedMenuCommand.pluginDisplayName} · {selectedMenuCommand.featureExplain}
                </div>
              </div>
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
                onClick={() => setSelectedMenuCommand(null)}
                aria-label="关闭"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
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
                  className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  onClick={() => void openCommand(selectedMenuCommand)}
                >
                  <Play className="h-4 w-4 text-slate-400" />
                  <span>打开指令</span>
                </button>
              )}
              {selectedMenuCommand.commandKind === 'launch' && (
                <button
                  className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  onClick={() => {
                    onRequestQuickLaunch?.(selectedMenuCommand.displayLabel, {
                      pluginId: selectedMenuCommand.pluginId,
                      featureCode: selectedMenuCommand.featureCode,
                      cmdId: selectedMenuCommand.cmdId
                    })
                    setSelectedMenuCommand(null)
                  }}
                >
                  <Keyboard className="h-4 w-4 text-slate-400" />
                  <span>设置全局快捷键</span>
                </button>
              )}
              <button
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${selectedMenuCommand.disabled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'border-red-200 bg-red-50 text-red-700 hover:border-red-300 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                  }`}
                onClick={() => void toggleCommandDisabled(selectedMenuCommand)}
              >
                {selectedMenuCommand.disabled ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                <span>{selectedMenuCommand.disabled ? '启用指令' : '禁用指令'}</span>
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-500 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                onClick={() => setSelectedMenuCommand(null)}
              >
                <X className="h-4 w-4 text-slate-400" />
                <span>取消</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
