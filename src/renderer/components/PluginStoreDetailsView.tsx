import { useEffect, useState } from 'react'
import type { PluginStoreEntry } from '../../shared/types/plugin-store'
import StorePluginDetailsPage from './StorePluginDetailsPage'

interface PluginStoreDetailsViewProps {
  entry: PluginStoreEntry
  onBack: () => void
}

function buildInstalledState(entry: PluginStoreEntry): PluginStoreEntry {
  return {
    ...entry,
    installState: {
      status: 'installed',
      installedVersion: entry.plugin.version,
      remoteVersion: entry.plugin.version
    }
  }
}

export default function PluginStoreDetailsView({
  entry,
  onBack
}: PluginStoreDetailsViewProps) {
  const [currentEntry, setCurrentEntry] = useState(entry)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    setCurrentEntry(entry)
  }, [entry])

  const handleInstall = async (nextEntry: PluginStoreEntry) => {
    const pluginLabel = nextEntry.plugin.displayName || nextEntry.plugin.name
    setInstalling(true)
    try {
      const result = await window.mulby.pluginStore.installFromUrl({
        pluginId: nextEntry.plugin.id,
        version: nextEntry.plugin.version,
        downloadUrl: nextEntry.plugin.downloadUrl,
        sourceId: nextEntry.sourceId,
        sourceName: nextEntry.sourceName,
        sourceUrl: nextEntry.sourceUrl,
        publisher: nextEntry.plugin.publisher,
        homepage: nextEntry.plugin.homepage,
        repository: nextEntry.plugin.repository,
        sha256: nextEntry.plugin.sha256
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

      setCurrentEntry(buildInstalledState(nextEntry))
    } catch (err) {
      const message = err instanceof Error ? err.message : '安装失败'
      window.mulby.notification.show(message, 'error')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <StorePluginDetailsPage
      entry={currentEntry}
      installing={installing}
      onBack={onBack}
      onInstall={(nextEntry) => void handleInstall(nextEntry)}
    />
  )
}
