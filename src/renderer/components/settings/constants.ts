import type { AppShortcutAction } from '../../../shared/types/settings'
import type { SettingsSection } from './types'

export const SECTION_ITEMS: { id: SettingsSection; label: string }[] = [
  { id: 'dashboard', label: '控制中心' },
  { id: 'general', label: '通用' },
  { id: 'floatingBall', label: '悬浮球' },
  { id: 'superPanel', label: '超级面板' },
  { id: 'commandQuickLaunch', label: '快捷启动' },
  { id: 'commandAll', label: '全部指令' },
  { id: 'permissions', label: '权限' },
  { id: 'security', label: '命令安全' },
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'developer', label: '开发者' },
  { id: 'about', label: '关于' }
]

export const SHORTCUTS: { id: AppShortcutAction; label: string; description: string }[] = [
  { id: 'toggleWindow', label: '唤起主窗口', description: '显示或隐藏主窗口' },
  { id: 'openSettings', label: '打开设置', description: '直接进入设置面板' }
]

/**
 * 权限列表，按平台区分
 * - platforms: 适用平台，undefined 表示所有平台
 * - importance: 'required' 必需 | 'recommended' 推荐 | 'optional' 可选
 * - canRequestProgrammatically: 是否支持从应用内触发系统授权入口
 */
export const PERMISSIONS: {
  id: 'accessibility' | 'screen' | 'microphone' | 'camera' | 'geolocation'
  label: string
  description: string
  platforms?: ('darwin' | 'win32' | 'linux')[]
  importance: 'required' | 'recommended' | 'optional'
  canRequestProgrammatically?: boolean
}[] = [
  {
    id: 'accessibility',
    label: '辅助功能',
    description: '全局键盘/鼠标监听（超级面板双击修饰键唤起）、原生取词（AX API 读取选中文本）',
    platforms: ['darwin'],
    importance: 'required',
    canRequestProgrammatically: true
  },
  {
    id: 'screen',
    label: '屏幕录制',
    description: '截图、区域截取、屏幕取色、AI 视觉分析等功能',
    platforms: ['darwin'],
    importance: 'recommended',
    canRequestProgrammatically: true
  },
  {
    id: 'microphone',
    label: '麦克风',
    description: '语音输入、语音对话等功能',
    importance: 'optional',
    canRequestProgrammatically: true
  },
  {
    id: 'camera',
    label: '摄像头',
    description: '视觉识别、实时画面分析等功能',
    importance: 'optional',
    canRequestProgrammatically: true
  },
  {
    id: 'geolocation',
    label: '定位',
    description: '天气插件、基于位置的智能推荐等功能',
    importance: 'optional',
    canRequestProgrammatically: true
  },
]

export const TOOL_CAPABILITY_OPTIONS = [
  { value: 'shell.exec', label: 'shell.exec（执行系统命令）' },
  { value: 'shell.script', label: 'shell.script（执行预置脚本）' },
  { value: 'fs.read', label: 'fs.read（读取文件）' },
  { value: 'fs.list', label: 'fs.list（列出目录）' },
  { value: 'fs.search', label: 'fs.search（文本检索）' },
  { value: 'patch.apply', label: 'patch.apply（补丁校验/应用）' },
  { value: 'http.fetch', label: 'http.fetch（HTTP 请求）' },
  { value: 'git.status', label: 'git.status（仓库状态）' },
  { value: 'git.diff', label: 'git.diff（差异查看）' }
] as const

export const DEFAULT_APP_CAPABILITIES = TOOL_CAPABILITY_OPTIONS.map((item) => item.value)
