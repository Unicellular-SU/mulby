import type { AppSettings, ShortcutStatusMap } from '../../../../shared/types/settings'
import { SHORTCUTS } from '../constants'
import ShortcutInput from '../ShortcutInput'

interface ShortcutsSectionProps {
  settings: AppSettings
  shortcutStatus: ShortcutStatusMap | null
  onShortcutChange: (action: keyof AppSettings['shortcuts'], accelerator: string) => Promise<void> | void
  onRecordStart: () => Promise<void> | void
  onRecordEnd: () => Promise<void> | void
}

export default function ShortcutsSection({
  settings,
  shortcutStatus,
  onShortcutChange,
  onRecordStart,
  onRecordEnd
}: ShortcutsSectionProps) {
  return (
    <div className="space-y-3">
      {SHORTCUTS.map(item => (
        <ShortcutInput
          key={item.id}
          label={item.label}
          description={item.description}
          value={settings.shortcuts[item.id]}
          status={shortcutStatus?.[item.id]}
          onChange={(accelerator) => onShortcutChange(item.id, accelerator)}
          onRecordStart={onRecordStart}
          onRecordEnd={onRecordEnd}
        />
      ))}
    </div>
  )
}
