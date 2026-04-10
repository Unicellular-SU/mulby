import { ProviderSettingsSection } from './ai-settings/ProviderSettingsSection'
import AiSettingsHeader from './ai-settings/AiSettingsHeader'
import AiSettingsStatusPanels from './ai-settings/AiSettingsStatusPanels'
import AiSettingsModalsHost from './ai-settings/AiSettingsModalsHost'
import { SettingsLikePageShell } from './SettingsLikePageChrome'
import { useAiSettingsViewModel } from './ai-settings/useAiSettingsViewModel'

interface AiSettingsViewProps {
  onBack: () => void
  onOpenMcpSettings?: () => void
  onOpenToolsSettings?: () => void
  onOpenSkillsSettings?: () => void
}

export default function AiSettingsView({ onBack, onOpenMcpSettings, onOpenToolsSettings, onOpenSkillsSettings }: AiSettingsViewProps) {
  const {
    headerProps,
    statusProps,
    providerSectionProps,
    modalsHostProps
  } = useAiSettingsViewModel({
    onBack,
    onOpenMcpSettings,
    onOpenToolsSettings,
    onOpenSkillsSettings
  })

  return (
    <SettingsLikePageShell>
      <AiSettingsHeader {...headerProps} />

      <div className="flex min-h-0 flex-1 no-drag">
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-6 pb-6 pt-6">
          <AiSettingsStatusPanels {...statusProps} />

          <div className="min-h-0 flex-1">
            <ProviderSettingsSection {...providerSectionProps} />
          </div>
        </div>
      </div>

      <AiSettingsModalsHost {...modalsHostProps} />
    </SettingsLikePageShell>
  )
}
