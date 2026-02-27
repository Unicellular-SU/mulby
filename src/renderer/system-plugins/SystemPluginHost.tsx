import SettingsView from '../components/SettingsView'
import type { SettingsSection } from '../components/SettingsView'
import type { SystemPluginRoute } from './types'

interface SystemPluginHostProps {
  route: SystemPluginRoute
  onSectionChange: (section: SettingsSection) => void
  onShortcutCommandHintConsumed: () => void
  onPrepareCommandLaunch?: () => Promise<void> | void
  onClose: () => void
  onOpenPluginManager: (section?: 'installed' | 'store') => void
  onOpenBackgroundPluginManager?: () => void
  onOpenTaskScheduler?: () => void
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
          onOpenLogViewer={onOpenLogViewer}
          onOpenAiSettings={onOpenAiSettings}
        />
      )
    default:
      return null
  }
}
