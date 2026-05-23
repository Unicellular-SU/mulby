import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, FloatingBallCommandTarget, FloatingBallSettings } from '../../../../shared/types/settings'
import type { PluginCommandItem } from '../../../../shared/types/plugin'

interface FloatingBallSectionProps {
  settings: AppSettings
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  cardClass: string
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

function commandKey(command?: FloatingBallCommandTarget): string {
  if (!command) return ''
  return `${command.pluginId}::${command.featureCode}`
}

function commandLabel(command: PluginCommandItem): string {
  const feature = command.featureExplain || command.displayLabel
  return `${command.pluginDisplayName} · ${feature}`
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

  useEffect(() => {
    let mounted = true
    window.mulby.plugin.listCommands().then((items) => {
      if (!mounted) return
      setCommands(items.filter((item) => item.commandKind === 'launch' && !item.disabled))
    }).catch(() => {
      if (mounted) setCommands([])
    })
    return () => {
      mounted = false
    }
  }, [])

  const commandOptions = useMemo(() => {
    const seen = new Set<string>()
    return commands.filter((command) => {
      const key = commandKey(command)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [commands])

  const patchFloatingBall = async (patch: Partial<FloatingBallSettings>) => {
    await updateSettings({
      floatingBall: {
        ...floatingBall,
        ...patch
      }
    })
  }

  const selectedCommand = commandKey(floatingBall.doubleClickCommand)

  return (
    <div className="space-y-4">
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
        <div className="text-sm font-medium text-slate-900 dark:text-white">双击动作</div>
        <select
          value={selectedCommand}
          disabled={!floatingBall.enabled}
          onChange={(event) => {
            const value = event.target.value
            if (!value) {
              void patchFloatingBall({ doubleClickCommand: undefined })
              return
            }
            const command = commandOptions.find((item) => commandKey(item) === value)
            if (!command) return
            void patchFloatingBall({
              doubleClickCommand: {
                pluginId: command.pluginId,
                featureCode: command.featureCode
              }
            })
          }}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60"
        >
          <option value="">同单击：显示/隐藏 Mulby</option>
          {commandOptions.map((command) => (
            <option key={commandKey(command)} value={commandKey(command)}>
              {commandLabel(command)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
