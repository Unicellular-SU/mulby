import type { ShortcutStatusMap } from '../../../shared/types/settings'

type ShortcutStatus = ShortcutStatusMap[keyof ShortcutStatusMap]

export function getShortcutStatusText(status?: ShortcutStatus): string {
  if (!status) return ''
  if (status.ok) {
    return status.via === 'hook' ? '已通过底层监听接管，其他应用可能同时响应' : ''
  }
  if (status.reason === 'duplicate') return '快捷键冲突'
  if (status.reason === 'system-reserved') return '系统保留快捷键'
  if (status.reason === 'in-use') return '被其他应用占用，正在尝试抢回…'
  if (status.reason === 'invalid') return '格式无效'
  return '注册失败'
}
