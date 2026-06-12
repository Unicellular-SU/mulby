import SettingsView from '../components/SettingsView'
import type { SettingsSection } from '../components/SettingsView'
import type { SystemPluginRoute } from './types'

interface SystemPluginHostProps {
  route: SystemPluginRoute
  onSectionChange: (section: SettingsSection) => void
  onShortcutCommandHintConsumed: () => void
  onPrepareCommandLaunch?: () => Promise<void> | void
  onClose: () => void
  onOpenPluginManager: (section?: 'installed' | 'store', storeFilter?: 'updatable') => void
  onOpenBackgroundPluginManager?: () => void
  onOpenTaskScheduler?: () => void
  onOpenStorageExplorer?: () => void
  onOpenLogViewer?: () => void
  onOpenAiSettings?: () => void
}

export default function SystemPluginHost({
  route,
  onSectionChange,
  onShortcutCommandHintConsumed,
  onPrepareCommandLaunch,
  onClose,
  onOpenPluginManager,
  onOpenBackgroundPluginManager,
  onOpenTaskScheduler,
  onOpenStorageExplorer,
  onOpenLogViewer,
  onOpenAiSettings
}: SystemPluginHostProps) {
  switch (route.pluginId) {
    case 'settings-center':
      return (
        <SettingsView
          section={route.params.section}
          shortcutCommandHint={route.params.shortcutCommandHint}
          onShortcutCommandHintConsumed={onShortcutCommandHintConsumed}
          onPrepareCommandLaunch={onPrepareCommandLaunch}
          onSectionChange={onSectionChange}
          onClose={onClose}
          onOpenPluginManager={onOpenPluginManager}
          onOpenBackgroundPluginManager={onOpenBackgroundPluginManager}
          onOpenTaskScheduler={onOpenTaskScheduler}
          onOpenStorageExplorer={onOpenStorageExplorer}
          onOpenLogViewer={onOpenLogViewer}
          onOpenAiSettings={onOpenAiSettings}
        />
      )
    default:
      return null
  }
}
