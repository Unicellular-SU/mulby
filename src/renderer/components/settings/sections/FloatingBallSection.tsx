import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type {
  AppSettings,
  FloatingBallActionBinding,
  FloatingBallGesture,
  FloatingBallSettings
} from '../../../../shared/types/settings'
import type { PluginCommandItem } from '../../../../shared/types/plugin'

interface FloatingBallSectionProps {
  settings: AppSettings
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  cardClass: string
}

interface FloatingBallActionDescription {
  title: string
  description: string
  unavailable: boolean
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked
        ? 'bg-blue-500'
        : 'bg-gray-300 dark:bg-gray-600'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  )
}

const builtinActions: Array<{
  action: Extract<FloatingBallActionBinding, { type: 'builtin' }>['action']
  title: string
  description: string
}> = [
  {
    action: 'toggleMulby',
    title: '显示/隐藏 Mulby',
    description: '切换主窗口显示状态'
  },
  {
    action: 'captureRegion',
    title: '区域截图投递',
    description: '截取区域并作为图片附件打开匹配结果'
  }
]

const gestureRows: Array<{ gesture: FloatingBallGesture; title: string; defaultAction: FloatingBallActionBinding }> = [
  { gesture: 'click', title: '单击', defaultAction: { type: 'builtin', action: 'toggleMulby' } },
  { gesture: 'doubleClick', title: '双击', defaultAction: { type: 'inheritClick' } },
  { gesture: 'longPress', title: '长按', defaultAction: { type: 'builtin', action: 'captureRegion' } }
]

function commandKey(command: Pick<PluginCommandItem, 'pluginId' | 'featureCode' | 'cmdId' | 'cmdSignature'>): string {
  return `${command.pluginId}::${command.featureCode}::${command.cmdId || ''}::${command.cmdSignature || ''}`
}

function commandLabel(command: PluginCommandItem): string {
  const feature = command.featureExplain || command.displayLabel
  return `${command.pluginDisplayName} · ${feature}`
}

function commandMatchesBinding(command: PluginCommandItem, binding: FloatingBallActionBinding): boolean {
  if (binding.type !== 'command') return false
  const target = binding.target
  if (command.pluginId !== target.pluginId || command.featureCode !== target.featureCode) return false
  if (target.cmdId && command.cmdId !== target.cmdId) return false
  if (target.cmdSignature && command.cmdSignature !== target.cmdSignature) return false
  return true
}

function getBuiltinTitle(action: Extract<FloatingBallActionBinding, { type: 'builtin' }>['action']): string {
  return builtinActions.find((item) => item.action === action)?.title || action
}

export default function FloatingBallSection({
  settings,
  updateSettings,
  cardClass
}: FloatingBallSectionProps) {
  const floatingBall = settings.floatingBall
  const [commands, setCommands] = useState<PluginCommandItem[]>([])
  const [sizeInput, setSizeInput] = useState('')
  const [opacityInput, setOpacityInput] = useState('')
  const [editingGesture, setEditingGesture] = useState<FloatingBallGesture | null>(null)
  const [actionSearch, setActionSearch] = useState('')

  useEffect(() => {
    let mounted = true
    window.mulby.plugin.listCommands().then((items) => {
      if (!mounted) return
      setCommands(items)
    }).catch(() => {
      if (mounted) setCommands([])
    })
    return () => {
      mounted = false
    }
  }, [])

  const actionCommandOptions = useMemo(() => {
    const seen = new Set<string>()
    return commands.filter((item) => item.commandKind === 'launch' && !item.disabled).filter((command) => {
      const key = commandKey(command)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [commands])

  const filteredActionCommands = useMemo(() => {
    const keyword = actionSearch.trim().toLowerCase()
    if (!keyword) return actionCommandOptions
    return actionCommandOptions.filter((item) => {
      const haystack = [
        item.displayLabel,
        item.pluginDisplayName,
        item.pluginName,
        item.featureExplain
      ].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [actionCommandOptions, actionSearch])

  const commandGroups = useMemo(() => {
    const groups = new Map<string, { pluginId: string; pluginDisplayName: string; pluginName: string; items: PluginCommandItem[] }>()
    for (const command of filteredActionCommands) {
      const group = groups.get(command.pluginId)
      if (group) {
        group.items.push(command)
      } else {
        groups.set(command.pluginId, {
          pluginId: command.pluginId,
          pluginDisplayName: command.pluginDisplayName,
          pluginName: command.pluginName,
          items: [command]
        })
      }
    }
    return Array.from(groups.values())
      .sort((a, b) => a.pluginDisplayName.localeCompare(b.pluginDisplayName))
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) => a.displayLabel.localeCompare(b.displayLabel))
      }))
  }, [filteredActionCommands])

  const patchFloatingBall = async (patch: Partial<FloatingBallSettings>) => {
    await updateSettings({
      floatingBall: {
        ...floatingBall,
        ...patch
      }
    })
  }

  const patchAction = async (gesture: FloatingBallGesture, binding: FloatingBallActionBinding) => {
    await patchFloatingBall({
      actions: {
        ...floatingBall.actions,
        [gesture]: binding
      }
    })
  }

  const describeAction = (gesture: FloatingBallGesture): FloatingBallActionDescription => {
    const binding = floatingBall.actions[gesture]
    if (binding.type === 'inheritClick') {
      return {
        title: '同单击动作',
        description: describeAction('click').title,
        unavailable: false
      }
    }
    if (binding.type === 'builtin') {
      return {
        title: getBuiltinTitle(binding.action),
        description: binding.action === 'toggleMulby' ? '内置动作' : '内置投递动作',
        unavailable: false
      }
    }
    const command = commands.find((item) => commandMatchesBinding(item, binding))
    if (!command) {
      return {
        title: binding.target.commandLabel || `${binding.target.pluginId} · ${binding.target.featureCode}`,
        description: '指令不可用',
        unavailable: true
      }
    }
    const commandUnavailable = command.disabled || command.commandKind !== 'launch'
    return {
      title: command.displayLabel,
      description: `${command.pluginDisplayName} · ${command.featureExplain || command.featureCode}${commandUnavailable ? ' · 指令不可用' : ''}`,
      unavailable: commandUnavailable
    }
  }

  const closeActionPicker = () => {
    setEditingGesture(null)
    setActionSearch('')
  }

  return (
    <div className="relative min-h-[calc(100vh-160px)] space-y-4">
      <div className={`${cardClass} space-y-4`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">显示悬浮球</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">在桌面保留一个可投递文件和截图的 Mulby 入口</div>
          </div>
          <Toggle
            checked={floatingBall.enabled}
            onChange={(enabled) => void patchFloatingBall({ enabled })}
          />
        </div>
      </div>

      <div className={`${cardClass} space-y-4 ${!floatingBall.enabled ? 'opacity-70' : ''}`}>
        <div className="text-sm font-medium text-slate-900 dark:text-white">外观</div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">球面文字</span>
            <input
              value={floatingBall.label}
              maxLength={2}
              disabled={!floatingBall.enabled}
              onChange={(event) => void patchFloatingBall({ label: event.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">大小</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={40}
                max={80}
                step={2}
                value={sizeInput || floatingBall.size}
                disabled={!floatingBall.enabled}
                onChange={(event) => setSizeInput(event.target.value)}
                onBlur={() => {
                  if (!sizeInput.trim()) {
                    setSizeInput('')
                    return
                  }
                  const next = Number(sizeInput)
                  if (Number.isFinite(next)) void patchFloatingBall({ size: next })
                  setSizeInput('')
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">px</span>
            </div>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">透明度</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={35}
                max={100}
                step={5}
                value={opacityInput || Math.round(floatingBall.opacity * 100)}
                disabled={!floatingBall.enabled}
                onChange={(event) => setOpacityInput(event.target.value)}
                onBlur={() => {
                  if (!opacityInput.trim()) {
                    setOpacityInput('')
                    return
                  }
                  const next = Number(opacityInput)
                  if (Number.isFinite(next)) void patchFloatingBall({ opacity: next / 100 })
                  setOpacityInput('')
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">%</span>
            </div>
          </label>

          <div className="flex items-center justify-between rounded-xl border border-slate-200/80 px-3 py-2 dark:border-slate-800/80">
            <div>
              <div className="text-sm text-slate-700 dark:text-slate-200">自动吸边</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">拖动松手后贴近左右屏幕边缘</div>
            </div>
            <Toggle
              checked={floatingBall.snapToEdge}
              disabled={!floatingBall.enabled}
              onChange={(snapToEdge) => void patchFloatingBall({ snapToEdge })}
            />
          </div>
        </div>

        <button
          disabled={!floatingBall.enabled}
          onClick={() => void patchFloatingBall({ position: undefined })}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          重置位置
        </button>
      </div>

      <div className={`${cardClass} space-y-4 ${!floatingBall.enabled ? 'opacity-70' : ''}`}>
        <div>
          <div className="text-sm font-medium text-slate-900 dark:text-white">交互动作</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">为悬浮球的单击、双击和长按绑定内置动作或插件功能指令</div>
        </div>
        <div className="divide-y divide-slate-200/80 overflow-hidden rounded-xl border border-slate-200/80 dark:divide-slate-800/80 dark:border-slate-800/80">
          {gestureRows.map((row) => {
            const action = describeAction(row.gesture)
            return (
              <div key={row.gesture} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">{row.title}</div>
                  <div className={`mt-1 truncate text-xs ${action.unavailable ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                    {action.title} · {action.description}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={!floatingBall.enabled}
                    onClick={() => setEditingGesture(row.gesture)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    更改
                  </button>
                  <button
                    disabled={!floatingBall.enabled}
                    onClick={() => void patchAction(row.gesture, row.defaultAction)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                  >
                    恢复默认
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {editingGesture && (
        <div
          className="fixed left-56 right-0 top-[73px] bottom-0 z-50 flex items-center justify-center bg-transparent px-4 py-6"
          onClick={closeActionPicker}
        >
          <div
            className="flex w-full max-w-xl max-h-[min(560px,calc(100vh-120px))] flex-col rounded-[20px] border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 p-4 dark:border-slate-800/80">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  选择{gestureRows.find((row) => row.gesture === editingGesture)?.title}动作
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  选择一个内置动作，或搜索可直接启动的插件功能指令
                </div>
              </div>
              <button
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white"
                onClick={closeActionPicker}
                aria-label="关闭"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {editingGesture === 'doubleClick' && (
                  <button
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950"
                    onClick={() => {
                      void patchAction(editingGesture, { type: 'inheritClick' })
                      closeActionPicker()
                    }}
                  >
                    <div className="text-sm font-medium text-slate-900 dark:text-white">同单击动作</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">双击执行当前单击绑定</div>
                  </button>
                )}
                {builtinActions.map((item) => (
                  <button
                    key={item.action}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950"
                    onClick={() => {
                      void patchAction(editingGesture, { type: 'builtin', action: item.action })
                      closeActionPicker()
                    }}
                  >
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.description}</div>
                  </button>
                ))}
              </div>

              <label className="mt-4 flex items-center gap-2 border-b border-slate-200/80 bg-transparent px-1 py-2.5 text-sm text-slate-700 transition focus-within:border-slate-400 dark:border-slate-800/80 dark:text-slate-200 dark:focus-within:border-slate-600">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  placeholder="搜索插件功能"
                  value={actionSearch}
                  onChange={(event) => setActionSearch(event.target.value)}
                />
              </label>

              {commandGroups.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  未找到可绑定的插件功能
                </div>
              ) : (
                <div className="mt-3 space-y-4">
                  {commandGroups.map((group) => (
                    <section key={group.pluginId} className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{group.pluginDisplayName}</div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">{group.pluginName}</div>
                        </div>
                        <div className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                          {group.items.length} 个功能
                        </div>
                      </div>
                      <div className="overflow-hidden border-y border-slate-200/70 dark:border-slate-800/80">
                        {group.items.map((command) => (
                          <button
                            key={`${commandKey(command)}:${command.displayLabel}`}
                            className="w-full border-b border-slate-200/70 px-3 py-2.5 text-left transition hover:bg-slate-100/70 last:border-b-0 dark:border-slate-800/80 dark:hover:bg-slate-950"
                            onClick={() => {
                              void patchAction(editingGesture, {
                                type: 'command',
                                target: {
                                  pluginId: command.pluginId,
                                  featureCode: command.featureCode,
                                  cmdId: command.cmdId,
                                  cmdSignature: command.cmdSignature,
                                  commandLabel: command.displayLabel
                                }
                              })
                              closeActionPicker()
                            }}
                          >
                            <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{command.displayLabel}</div>
                            <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                              {commandLabel(command)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
