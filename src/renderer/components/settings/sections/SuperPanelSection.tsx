import { useState, useRef, useEffect } from 'react'
import type {
  AppSettings,
  SuperPanelSettings,
  SuperPanelTriggerType,
  SuperPanelMouseButton,
  DoubleTapModifier
} from '../../../../shared/types/settings'
import ShortcutInput from '../ShortcutInput'

interface SuperPanelSectionProps {
  settings: AppSettings
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  cardClass: string
  onRecordStart: () => Promise<void> | void
  onRecordEnd: () => Promise<void> | void
}

// ==================== 内联通用组件 ====================

/** 开关组件（复用 GeneralSection 的模式） */
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

/** 单选药片组 */
function RadioPills<T extends string>({
  options,
  value,
  onChange,
  disabled
}: {
  options: { value: T; label: string; description?: string }[]
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
          title={opt.description}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ==================== 选项常量 ====================

const TRIGGER_TYPE_OPTIONS: { value: SuperPanelTriggerType; label: string; description: string }[] = [
  { value: 'mouse_click', label: '鼠标单击', description: '点击指定鼠标按键触发' },
  { value: 'mouse_longpress', label: '鼠标长按', description: '长按指定鼠标按键触发' },
  { value: 'keyboard', label: '键盘快捷键', description: '按下快捷键组合触发' },
  { value: 'double_tap', label: '双击修饰键', description: '快速双击修饰键触发' },
]

const MOUSE_BUTTON_OPTIONS: { value: SuperPanelMouseButton; label: string }[] = [
  { value: 'middle', label: '中键' },
  { value: 'right', label: '右键' },
  { value: 'back', label: '侧键后退' },
  { value: 'forward', label: '侧键前进' },
]

const MODIFIER_OPTIONS: { value: DoubleTapModifier; label: string }[] = [
  { value: 'Command', label: '⌘ Command' },
  { value: 'Ctrl', label: '⌃ Ctrl' },
  { value: 'Alt', label: '⌥ Alt' },
  { value: 'Shift', label: '⇧ Shift' },
]

// ==================== 子组件 ====================

/** 触发方式配置卡片 */
function TriggerSection({
  superPanel,
  onUpdate,
  cardClass,
  onRecordStart,
  onRecordEnd
}: {
  superPanel: SuperPanelSettings
  onUpdate: (patch: Partial<SuperPanelSettings>) => void
  cardClass: string
  onRecordStart: () => Promise<void> | void
  onRecordEnd: () => Promise<void> | void
}) {
  const [longPressInput, setLongPressInput] = useState('')
  const { trigger } = superPanel

  return (
    <div className={`${cardClass} space-y-4`}>
      <div className="text-sm font-medium text-slate-900 dark:text-white">触发方式</div>

      {/* 触发类型选择 */}
      <div className="space-y-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">触发模式</div>
        <RadioPills
          options={TRIGGER_TYPE_OPTIONS}
          value={trigger.type}
          onChange={(v) => onUpdate({ trigger: { ...trigger, type: v } })}
          disabled={!superPanel.enabled}
        />
      </div>

      {/* 鼠标按键 - mouse_click / mouse_longpress */}
      {(trigger.type === 'mouse_click' || trigger.type === 'mouse_longpress') && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">鼠标按键</div>
          <RadioPills
            options={MOUSE_BUTTON_OPTIONS}
            value={trigger.mouseButton || 'middle'}
            onChange={(v) => onUpdate({ trigger: { ...trigger, mouseButton: v } })}
            disabled={!superPanel.enabled}
          />
        </div>
      )}

      {/* 长按阈值 - mouse_longpress */}
      {trigger.type === 'mouse_longpress' && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">长按时间</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={200}
              max={3000}
              step={50}
              value={longPressInput || trigger.longPressMs || 500}
              onChange={(e) => setLongPressInput(e.target.value)}
              onBlur={() => {
                const val = Number(longPressInput)
                if (val >= 200 && val <= 3000) {
                  onUpdate({ trigger: { ...trigger, longPressMs: val } })
                }
                setLongPressInput('')
              }}
              disabled={!superPanel.enabled}
              className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">毫秒</span>
          </div>
        </div>
      )}

      {/* 快捷键 - keyboard */}
      {trigger.type === 'keyboard' && (
        <div className="space-y-2">
          <ShortcutInput
            variant="inline"
            label="快捷键组合"
            description="点击录制后按下快捷键组合，按 Esc 取消。"
            value={trigger.accelerator || ''}
            onChange={(accelerator) => onUpdate({ trigger: { ...trigger, accelerator } })}
            onRecordStart={onRecordStart}
            onRecordEnd={onRecordEnd}
          />
        </div>
      )}

      {/* 双击修饰键 - double_tap */}
      {trigger.type === 'double_tap' && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 dark:text-slate-400">修饰键</div>
          <RadioPills
            options={MODIFIER_OPTIONS}
            value={trigger.modifier || 'Command'}
            onChange={(v) => onUpdate({ trigger: { ...trigger, modifier: v } })}
            disabled={!superPanel.enabled}
          />
        </div>
      )}

      {/* 使用提示 */}
      <div className="rounded-2xl border border-blue-200/80 bg-blue-50/70 px-3 py-2 text-xs text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
        {trigger.type === 'mouse_click' && '选中文本后点击对应鼠标按键即可唤起超级面板。中键可能与浏览器滚动冲突，请按需选择。'}
        {trigger.type === 'mouse_longpress' && '选中文本后长按对应鼠标按键超过设定时间即可唤起。'}
        {trigger.type === 'keyboard' && '选中文本后按下快捷键即可唤起。请确保快捷键不与其他应用冲突。'}
        {trigger.type === 'double_tap' && '选中文本后快速双击修饰键即可唤起。长按或与其他键组合不会触发。'}
      </div>
    </div>
  )
}

/** 黑名单管理卡片 */
function BlockedAppsSection({
  superPanel,
  onUpdate,
  cardClass
}: {
  superPanel: SuperPanelSettings
  onUpdate: (patch: Partial<SuperPanelSettings>) => void
  cardClass: string
}) {
  const [newApp, setNewApp] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addApp = () => {
    const val = newApp.trim()
    if (!val) return
    if (superPanel.blockedApps.includes(val)) {
      setNewApp('')
      return
    }
    onUpdate({ blockedApps: [...superPanel.blockedApps, val] })
    setNewApp('')
    inputRef.current?.focus()
  }

  const removeApp = (app: string) => {
    onUpdate({ blockedApps: superPanel.blockedApps.filter(a => a !== app) })
  }

  return (
    <div className={`${cardClass} space-y-4`}>
      <div className="text-sm font-medium text-slate-900 dark:text-white">应用黑名单</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        以下应用处于活跃状态时，超级面板不会被触发。支持 macOS Bundle ID、应用名称或 Windows .exe 文件名。
      </div>

      {/* 添加输入 */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          placeholder="输入应用名或 Bundle ID..."
          value={newApp}
          onChange={(e) => setNewApp(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addApp()
          }}
          disabled={!superPanel.enabled}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60"
        />
        <button
          onClick={addApp}
          disabled={!superPanel.enabled || !newApp.trim()}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          添加
        </button>
      </div>

      {/* 黑名单列表 */}
      {superPanel.blockedApps.length > 0 && (
        <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800/80">
          {superPanel.blockedApps.map((app, index) => (
            <div
              key={app}
              className={`flex items-center justify-between px-3 py-2 text-sm ${index > 0 ? 'border-t border-slate-100 dark:border-slate-800/60' : ''
                }`}
            >
              <span className="truncate text-slate-700 dark:text-slate-300">{app}</span>
              <button
                onClick={() => removeApp(app)}
                disabled={!superPanel.enabled}
                className="ml-2 shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                title="移除"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {superPanel.blockedApps.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
          暂无屏蔽应用。超级面板将在所有应用中可用。
        </div>
      )}
    </div>
  )
}

/** 高级参数卡片 */
function AdvancedSection({
  superPanel,
  onUpdate,
  cardClass
}: {
  superPanel: SuperPanelSettings
  onUpdate: (patch: Partial<SuperPanelSettings>) => void
  cardClass: string
}) {
  const [pollInput, setPollInput] = useState('')
  const [maxItemsInput, setMaxItemsInput] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className={`${cardClass} space-y-4`}>
      <button
        className="flex w-full items-center justify-between text-sm font-medium text-slate-900 dark:text-white"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span>高级设置</span>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isExpanded && (
        <div className="space-y-4 pt-1">
          {/* 剪贴板轮询延迟 */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-700 dark:text-slate-200">剪贴板检测延迟</div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                模拟复制后等待剪贴板更新的最大时间
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={30}
                max={500}
                step={10}
                value={pollInput || superPanel.clipboardPollDelayMs}
                onChange={(e) => setPollInput(e.target.value)}
                onBlur={() => {
                  const val = Number(pollInput)
                  if (val >= 30 && val <= 500) {
                    onUpdate({ clipboardPollDelayMs: val })
                  }
                  setPollInput('')
                }}
                disabled={!superPanel.enabled}
                className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">ms</span>
            </div>
          </div>

          {/* 最大显示条目 */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-700 dark:text-slate-200">最大显示条目</div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                面板中最多显示的匹配结果数量
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={3}
                max={30}
                step={1}
                value={maxItemsInput || superPanel.maxItems}
                onChange={(e) => setMaxItemsInput(e.target.value)}
                onBlur={() => {
                  const val = Number(maxItemsInput)
                  if (val >= 3 && val <= 30) {
                    onUpdate({ maxItems: val })
                  }
                  setMaxItemsInput('')
                }}
                disabled={!superPanel.enabled}
                className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">条</span>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            修改高级参数可能影响取词准确性和面板响应速度，建议保持默认值。
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== 主组件 ====================

export default function SuperPanelSection({
  settings,
  updateSettings,
  cardClass,
  onRecordStart,
  onRecordEnd
}: SuperPanelSectionProps) {
  const superPanel = settings.superPanel
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    window.mulby.system.isMacOS().then(setIsMac).catch(() => setIsMac(false))
  }, [])

  const handleUpdate = async (patch: Partial<SuperPanelSettings>) => {
    await updateSettings({
      superPanel: {
        ...settings.superPanel,
        ...patch
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* 总开关卡片 */}
      <div className={`${cardClass} space-y-4`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">超级面板</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              选中文本后快速触发，智能匹配可执行的插件指令
            </div>
          </div>
          <Toggle
            checked={superPanel.enabled}
            onChange={(v) => void handleUpdate({ enabled: v })}
          />
        </div>

        {superPanel.enabled && isMac && superPanel.trigger.type === 'mouse_click' && superPanel.trigger.mouseButton === 'middle' && (
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            💡 macOS 触控板没有鼠标中键。如果你使用触控板，建议切换到「键盘快捷键」或「双击修饰键」触发方式。
          </div>
        )}
      </div>

      {/* 以下配置项仅在启用时展示 */}
      {superPanel.enabled && (
        <>
          <div className={`${cardClass} space-y-4`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">即时翻译</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  选中文本唤起面板时，自动调用 AI 生成翻译并在首部展示
                </div>
              </div>
              <Toggle
                checked={superPanel.instantTranslation !== false}
                onChange={(v) => void handleUpdate({ instantTranslation: v })}
                disabled={!superPanel.enabled}
              />
            </div>

            {superPanel.instantTranslation !== false && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-700 dark:text-slate-200">最大翻译长度</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">
                    超过此字符数的文本不触发即时翻译
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={100}
                    max={50000}
                    step={500}
                    defaultValue={superPanel.translationMaxLength ?? 5000}
                    onBlur={(e) => {
                      const val = Number(e.target.value)
                      if (val >= 100 && val <= 50000) {
                        void handleUpdate({ translationMaxLength: val })
                      }
                    }}
                    disabled={!superPanel.enabled}
                    className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60"
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">字符</span>
                </div>
              </div>
            )}
          </div>

          <TriggerSection
            superPanel={superPanel}
            onUpdate={handleUpdate}
            cardClass={cardClass}
            onRecordStart={onRecordStart}
            onRecordEnd={onRecordEnd}
          />

          <BlockedAppsSection
            superPanel={superPanel}
            onUpdate={handleUpdate}
            cardClass={cardClass}
          />

          <AdvancedSection
            superPanel={superPanel}
            onUpdate={handleUpdate}
            cardClass={cardClass}
          />
        </>
      )}
    </div>
  )
}
