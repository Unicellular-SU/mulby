import type { UpdateCenterState } from '../../../shared/types/electron'
import { TOOL_CAPABILITY_OPTIONS } from './constants'

export function formatPermissionStatus(status: string) {
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

export function parseListDraft(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function formatCommandAuditStatus(status: string): string {
  switch (status) {
    case 'allowed':
      return '允许'
    case 'blocked':
      return '拦截'
    case 'timeout':
      return '超时'
    case 'error':
      return '错误'
    default:
      return status
  }
}

export function formatCapabilityLabel(capability: string): string {
  const row = TOOL_CAPABILITY_OPTIONS.find((item) => item.value === capability)
  return row?.label || capability
}

export function toDateTimeLocalValue(input?: number): string {
  if (!input || !Number.isFinite(input)) return ''
  const date = new Date(input)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatUpdateStatus(status: UpdateCenterState['status']): string {
  switch (status) {
    case 'checking':
      return '检查中'
    case 'up-to-date':
      return '已是最新版本'
    case 'update-available':
      return '发现新版本'
    case 'downloading':
      return '下载中'
    case 'downloaded':
      return '已下载，待安装'
    case 'error':
      return '检查失败'
    default:
      return '未检查'
  }
}

export function formatCheckedAt(input?: number): string {
  if (!input || !Number.isFinite(input)) return '尚未检查'
  return new Date(input).toLocaleString()
}

export function normalizeShortcutKey(event: KeyboardEvent) {
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
