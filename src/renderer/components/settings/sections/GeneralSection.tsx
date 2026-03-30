import { useState } from 'react'
import type { StartupOpenAtLoginState } from '../../../../shared/types/electron'
import type {
  AppSettings,
  DoubleTapModifier,
  DoubleTapSettings,
  MouseTriggerAction,
  MouseTriggerButton,
  MouseTriggerSettings,
  SearchSettings,
  ShortcutStatusMap
} from '../../../../shared/types/settings'
import { SHORTCUTS } from '../constants'
import ShortcutInput from '../ShortcutInput'

interface GeneralSectionProps {
  themeMode: 'light' | 'dark' | 'system'
  onThemeModeChange: (mode: 'light' | 'dark' | 'system') => Promise<void> | void
  openAtLoginState: StartupOpenAtLoginState
  startupBusy: boolean
  onToggleOpenAtLogin: () => Promise<void> | void
  searchSettings: SearchSettings
  onSearchSettingsChange: (patch: Partial<SearchSettings>) => Promise<void> | void
  settings: AppSettings | null
  shortcutStatus: ShortcutStatusMap | null
  onShortcutChange: (action: keyof AppSettings['shortcuts'], accelerator: string) => Promise<void> | void
  onRecordStart: () => Promise<void> | void
  onRecordEnd: () => Promise<void> | void
  onMouseTriggerChange: (patch: Partial<MouseTriggerSettings>) => Promise<void> | void
  onDoubleTapChange: (patch: Partial<DoubleTapSettings>) => Promise<void> | void
  cardClass: string
}

// 开关组件
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
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  )
}

// 单选按钮组
function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  disabled
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          disabled={disabled}
          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${value === opt.value
            ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

const MOUSE_BUTTON_OPTIONS: { value: MouseTriggerButton; label: string }[] = [
  { value: 'middle', label: '中键' },
  { value: 'back', label: '侧键后退' },
  { value: 'forward', label: '侧键前进' },
]

const MOUSE_ACTION_OPTIONS: { value: MouseTriggerAction; label: string }[] = [
  { value: 'click', label: '单击' },
  { value: 'longpress', label: '长按' },
]

const MODIFIER_OPTIONS: { value: DoubleTapModifier; label: string }[] = [
  { value: 'Command', label: '⌘ Command' },
  { value: 'Ctrl', label: '⌃ Ctrl' },
  { value: 'Alt', label: '⌥ Alt' },
  { value: 'Shift', label: '⇧ Shift' },
]

export default function GeneralSection({
  themeMode,
  onThemeModeChange,
  openAtLoginState,
  startupBusy,
  onToggleOpenAtLogin,
  searchSettings,
  onSearchSettingsChange,
  settings,
  shortcutStatus,
  onShortcutChange,
  onRecordStart,
  onRecordEnd,
  onMouseTriggerChange,
  onDoubleTapChange,
  cardClass
}: GeneralSectionProps) {
  const [longPressInput, setLongPressInput] = useState<string>('')

  const mouseTrigger = settings?.mouseTrigger
  const doubleTap = settings?.doubleTap

  return (
    <div className="space-y-4">
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
              onClick={() => void onThemeModeChange(mode)}
            >
              {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}
            </button>
          ))}
        </div>
      </div>

      <div className={`${cardClass} space-y-4`}>
        <div className="text-sm font-medium text-slate-900 dark:text-white">开机自启动</div>
        {!openAtLoginState.supported && (
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            当前平台暂不支持开机自启动管理，仅支持 macOS 和 Windows。
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            状态：{openAtLoginState.enabled ? '已开启' : '已关闭'}
          </div>
          <Toggle
            checked={openAtLoginState.enabled}
            onChange={() => void onToggleOpenAtLogin()}
            disabled={!openAtLoginState.supported || startupBusy}
          />
        </div>
      </div>

      <div className={`${cardClass} space-y-4`}>
        <div className="text-sm font-medium text-slate-900 dark:text-white">搜索设置</div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-700 dark:text-slate-200">搜索本机应用</div>
          </div>
          <Toggle
            checked={searchSettings.enableApps}
            onChange={() => void onSearchSettingsChange({ enableApps: !searchSettings.enableApps })}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-700 dark:text-slate-200">搜索本机文件</div>
          </div>
          <Toggle
            checked={searchSettings.enableFiles}
            onChange={() => void onSearchSettingsChange({ enableFiles: !searchSettings.enableFiles })}
          />
        </div>
      </div>

      {settings && (
        <div className={`${cardClass} space-y-3`}>
          <div className="text-sm font-medium text-slate-900 dark:text-white">全局快捷键</div>
          {SHORTCUTS.map(item => (
            <ShortcutInput
              key={item.id}
              label={item.label}
              description={item.description}
              value={settings.shortcuts[item.id]}
              status={shortcutStatus?.[item.id]}
              onChange={(accelerator) => onShortcutChange(item.id, accelerator)}
              onRecordStart={onRecordStart}
              onRecordEnd={onRecordEnd}
            />
          ))}
        </div>
      )}

      {/* P2-A: 鼠标触发卡片 */}
      {mouseTrigger && (
        <div className={`${cardClass} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-900 dark:text-white">鼠标触发</div>
            <Toggle
              checked={mouseTrigger.enabled}
              onChange={(v) => void onMouseTriggerChange({ enabled: v })}
            />
          </div>

          {mouseTrigger.enabled && (
            <>
              <div className="space-y-2">
                <div className="text-xs text-slate-500 dark:text-slate-400">触发按钮</div>
                <RadioGroup
                  options={MOUSE_BUTTON_OPTIONS}
                  value={mouseTrigger.button}
                  onChange={(v) => void onMouseTriggerChange({ button: v })}
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs text-slate-500 dark:text-slate-400">触发方式</div>
                <RadioGroup
                  options={MOUSE_ACTION_OPTIONS}
                  value={mouseTrigger.action}
                  onChange={(v) => void onMouseTriggerChange({ action: v })}
                />
              </div>

              {mouseTrigger.action === 'longpress' && (
                <div className="space-y-2">
                  <div className="text-xs text-slate-500 dark:text-slate-400">长按时间</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={200}
                      max={3000}
                      step={50}
                      value={longPressInput || mouseTrigger.longPressMs}
                      onChange={(e) => setLongPressInput(e.target.value)}
                      onBlur={() => {
                        const val = Number(longPressInput)
                        if (val >= 200 && val <= 3000) {
                          void onMouseTriggerChange({ longPressMs: val })
                        }
                        setLongPressInput('')
                      }}
                      className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <span className="text-xs text-slate-500 dark:text-slate-400">ms</span>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-blue-200/80 bg-blue-50/70 px-3 py-2 text-xs text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                按下对应鼠标按钮可唤起主窗口。中键可能与浏览器滚动等功能冲突，请按需选择。
              </div>
            </>
          )}
        </div>
      )}

      {/* P2-B: 双击修饰键卡片 */}
      {doubleTap && (
        <div className={`${cardClass} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-900 dark:text-white">双击修饰键唤醒</div>
            <Toggle
              checked={doubleTap.enabled}
              onChange={(v) => void onDoubleTapChange({ enabled: v })}
            />
          </div>

          {doubleTap.enabled && (
            <>
              <div className="space-y-2">
                <div className="text-xs text-slate-500 dark:text-slate-400">修饰键</div>
                <RadioGroup
                  options={MODIFIER_OPTIONS}
                  value={doubleTap.modifier}
                  onChange={(v) => void onDoubleTapChange({ modifier: v })}
                />
              </div>

              <div className="rounded-2xl border border-blue-200/80 bg-blue-50/70 px-3 py-2 text-xs text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                快速双击选定的修饰键可唤起主窗口。长按或与其他键组合不会触发。
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
