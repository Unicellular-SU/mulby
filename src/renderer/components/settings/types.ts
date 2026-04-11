export type SettingsSection =
  | 'dashboard'
  | 'general'
  | 'superPanel'
  | 'commandQuickLaunch'
  | 'commandAll'
  | 'permissions'
  | 'security'
  | 'openclaw'
  | 'developer'
  | 'about'

export interface SettingsViewProps {
  section: SettingsSection
  shortcutCommandHint?: string
  onShortcutCommandHintConsumed?: () => void
  onPrepareCommandLaunch?: () => Promise<void> | void
  onSectionChange: (section: SettingsSection) => void
  onClose: () => void
  onOpenPluginManager: (section?: 'installed' | 'store') => void
  onOpenBackgroundPluginManager?: () => void
  onOpenTaskScheduler?: () => void
  onOpenStorageExplorer?: () => void
  onOpenLogViewer?: () => void
  onOpenAiSettings?: () => void
}
