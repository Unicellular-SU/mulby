import type {
  DoubleTapModifier,
  SuperPanelMouseButton,
  SuperPanelSettings,
  SuperPanelTriggerType
} from '../../shared/types/settings'

export interface OnboardingUsageStep {
  name: string
  desc: string
  bg: string
  color: string
}

export interface OnboardingOption<T extends string> {
  value: T
  label: string
  description?: string
}

const DEFAULT_SUPER_PANEL_TRIGGER: SuperPanelSettings['trigger'] = {
  type: 'keyboard',
  accelerator: 'Alt+Q'
}

export const ONBOARDING_USAGE_STEPS: OnboardingUsageStep[] = [
  {
    name: '唤起 Mulby',
    desc: '使用刚才设置的快捷键，从任何地方打开主窗口。',
    bg: 'linear-gradient(135deg, #ede9fe, #dbeafe)',
    color: '#7c3aed'
  },
  {
    name: '搜索并运行',
    desc: '输入插件名称、命令关键词或系统应用名称，然后回车执行。',
    bg: 'linear-gradient(135deg, #d1fae5, #dbeafe)',
    color: '#059669'
  },
  {
    name: '打开超级面板',
    desc: '选中文本或复制内容后触发超级面板，相关工具会优先出现。',
    bg: 'linear-gradient(135deg, #fef3c7, #fce7f3)',
    color: '#d97706'
  },
  {
    name: '继续探索',
    desc: '从插件商店、托盘菜单和设置中心继续扩展你的工作流。',
    bg: 'linear-gradient(135deg, #fce7f3, #ede9fe)',
    color: '#d946ef'
  }
]

export const ONBOARDING_SUPER_PANEL_TRIGGER_OPTIONS: OnboardingOption<SuperPanelTriggerType>[] = [
  { value: 'keyboard', label: '键盘快捷键', description: '推荐，冲突最少，适合首次上手' },
  { value: 'mouse_click', label: '鼠标单击', description: '点击指定鼠标按键触发' },
  { value: 'mouse_longpress', label: '鼠标长按', description: '长按指定鼠标按键触发' },
  { value: 'double_tap', label: '双击修饰键', description: '快速双击 Ctrl、Alt 等修饰键触发' }
]

export const ONBOARDING_SUPER_PANEL_MOUSE_OPTIONS: OnboardingOption<SuperPanelMouseButton>[] = [
  { value: 'middle', label: '中键' },
  { value: 'right', label: '右键' },
  { value: 'back', label: '侧键后退' },
  { value: 'forward', label: '侧键前进' }
]

export const ONBOARDING_SUPER_PANEL_MODIFIER_OPTIONS: OnboardingOption<DoubleTapModifier>[] = [
  { value: 'Ctrl', label: 'Ctrl' },
  { value: 'Alt', label: 'Alt' },
  { value: 'Shift', label: 'Shift' },
  { value: 'Command', label: 'Command' }
]

export function createDefaultOnboardingSuperPanel(existing?: SuperPanelSettings): SuperPanelSettings {
  return {
    blockedApps: existing?.blockedApps || [],
    clipboardPollDelayMs: existing?.clipboardPollDelayMs ?? 80,
    maxItems: existing?.maxItems ?? 10,
    instantTranslation: existing?.instantTranslation ?? true,
    translationMaxLength: existing?.translationMaxLength ?? 5000,
    enabled: existing?.enabled ?? false,
    trigger: existing?.enabled ? existing.trigger : DEFAULT_SUPER_PANEL_TRIGGER
  }
}
