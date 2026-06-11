/**
 * 插件卸载确认流程（三处入口共用：搜索面板右键菜单 / 插件管理页 / 插件详情页）
 *
 * 卸载前查询插件的存储数据统计：
 * - 无数据：维持原有"取消 / 卸载"两键确认
 * - 有数据：展示数据量（KV 条数、附件数量与大小），提供
 *   "卸载并保留数据"（重装后可恢复）与"卸载并删除数据"两种选择
 */

export interface UninstallOutcome {
  status: 'cancelled' | 'success' | 'error'
  /** status === 'success' 时表示是否同时删除了插件数据 */
  purgedData?: boolean
  error?: string
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`
}

export async function confirmAndUninstallPlugin(name: string, displayName: string): Promise<UninstallOutcome> {
  const stats = await window.mulby.plugin.getDataStats(name).catch(() => null)
  const hasData = !!stats && (stats.kvCount > 0 || stats.encryptedCount > 0 || stats.attachmentCount > 0)

  if (!hasData) {
    const { response } = await window.mulby.dialog.showMessageBox({
      type: 'question',
      title: '卸载插件',
      message: `确定要卸载插件「${displayName}」吗？`,
      buttons: ['取消', '卸载'],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return { status: 'cancelled' }
    const result = await window.mulby.plugin.uninstall(name)
    return result.success
      ? { status: 'success', purgedData: false }
      : { status: 'error', error: result.error || '卸载失败' }
  }

  const parts: string[] = []
  if (stats.kvCount > 0) parts.push(`${stats.kvCount} 条存储数据`)
  if (stats.encryptedCount > 0) parts.push(`${stats.encryptedCount} 个加密项`)
  if (stats.attachmentCount > 0) parts.push(`${stats.attachmentCount} 个附件文件（${formatBytes(stats.attachmentBytes)}）`)
  const { response } = await window.mulby.dialog.showMessageBox({
    type: 'question',
    title: '卸载插件',
    message: `确定要卸载插件「${displayName}」吗？`,
    detail: `该插件存有 ${parts.join('、')}。\n保留数据后重新安装该插件即可恢复；删除后不可找回。`,
    buttons: ['取消', '卸载并保留数据', '卸载并删除数据'],
    defaultId: 1,
    cancelId: 0
  })
  if (response !== 1 && response !== 2) return { status: 'cancelled' }

  const purgeData = response === 2
  const result = await window.mulby.plugin.uninstall(name, { purgeData })
  return result.success
    ? { status: 'success', purgedData: purgeData }
    : { status: 'error', error: result.error || '卸载失败' }
}
