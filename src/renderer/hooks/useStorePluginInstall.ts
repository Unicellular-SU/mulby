import { useCallback, useState } from 'react'
import type { PluginStoreEntry, PluginStoreInstallResult } from '../../shared/types/plugin-store'
import { getStorePluginDisplayName } from '../utils/plugin-store-helpers'

interface UseStorePluginInstallOptions {
  onSuccess?: (entry: PluginStoreEntry, result: PluginStoreInstallResult) => void
}

export default function useStorePluginInstall(options?: UseStorePluginInstallOptions) {
  const [installingKey, setInstallingKey] = useState<string | null>(null)

  const install = useCallback(async (entry: PluginStoreEntry) => {
    const key = `${entry.plugin.id}:${entry.plugin.version}`
    const pluginLabel = getStorePluginDisplayName(entry.plugin)
    setInstallingKey(key)
    try {
      const result = await window.mulby.pluginStore.installFromUrl({
        pluginId: entry.plugin.id,
        version: entry.plugin.version,
        downloadUrl: entry.plugin.downloadUrl,
        sourceId: entry.sourceId,
        sourceName: entry.sourceName,
        sourceUrl: entry.sourceUrl,
        publisher: entry.plugin.publisher,
        homepage: entry.plugin.homepage,
        repository: entry.plugin.repository,
        sha256: entry.plugin.sha256
      })

      if (!result.success) {
        window.mulby.notification.show(result.error || '安装失败', 'error')
        return
      }

      if (result.action === 'updated') {
        window.mulby.notification.show(`插件 ${pluginLabel} 更新成功`, 'success')
      } else if (result.action === 'already-installed') {
        window.mulby.notification.show(`插件 ${pluginLabel} 已是当前版本`)
      } else {
        window.mulby.notification.show(`插件 ${pluginLabel} 安装成功`, 'success')
      }

      if (result.integrityStatus === 'verified' && result.action !== 'already-installed') {
        window.mulby.notification.show(`插件 ${pluginLabel} 的 SHA256 已通过校验`)
      } else if (result.integrityStatus === 'missing' && result.action !== 'already-installed') {
        window.mulby.notification.show(`插件 ${pluginLabel} 未提供 SHA256 校验信息`)
      }

      options?.onSuccess?.(entry, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : '安装失败'
      window.mulby.notification.show(message, 'error')
    } finally {
      setInstallingKey(null)
    }
  }, [options])

  const isInstalling = useCallback(
    (entry: PluginStoreEntry) =>
      installingKey === `${entry.plugin.id}:${entry.plugin.version}`,
    [installingKey]
  )

  return { installingKey, install, isInstalling }
}
