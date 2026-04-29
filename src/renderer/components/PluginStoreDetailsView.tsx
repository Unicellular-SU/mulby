import { useEffect, useState } from 'react'
import type { PluginStoreEntry } from '../../shared/types/plugin-store'
import useStorePluginInstall from '../hooks/useStorePluginInstall'
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

  useEffect(() => {
    setCurrentEntry(entry)
  }, [entry])

  const { install, isInstalling } = useStorePluginInstall({
    onSuccess: (e) => setCurrentEntry(buildInstalledState(e))
  })

  return (
    <StorePluginDetailsPage
      entry={currentEntry}
      installing={isInstalling(currentEntry)}
      onBack={onBack}
      onInstall={(e) => void install(e)}
    />
  )
}
