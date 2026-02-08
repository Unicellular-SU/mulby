import { dialog } from 'electron'
import type { AppSettings, CommandRunnerSettings } from '../../shared/types/settings'
import { appSettingsManager } from './app-settings'
import { withDialogMode } from './blur-manager'
import {
  CommandRunnerService,
  type CommandConsentDecision,
  type CommandConsentRequest
} from './command-runner-core'

function updateCommandRunnerSettings(next: CommandRunnerSettings): CommandRunnerSettings {
  const updated = appSettingsManager.updateSettings({
    commandRunner: next
  } as Partial<AppSettings>)
  return updated.commandRunner
}

async function requestConsentByDialog(request: CommandConsentRequest): Promise<CommandConsentDecision> {
  const response = await withDialogMode(async () => {
    return await dialog.showMessageBox({
      type: 'warning',
      title: request.title,
      message: request.message,
      detail: request.detail,
      buttons: ['拒绝', '仅本次允许', '信任并允许'],
      defaultId: 0,
      cancelId: 0
    })
  })

  if (response.response === 2) return 'trust'
  if (response.response === 1) return 'allow-once'
  return 'deny'
}

export const commandRunnerService = new CommandRunnerService({
  getPolicy: () => appSettingsManager.getSettings().commandRunner,
  updatePolicy: updateCommandRunnerSettings,
  requestConsent: requestConsentByDialog
})

export {
  CommandRunnerService
}
export type {
  RunCommandInput,
  RunCommandResult,
  RunCommandContext
} from './command-runner-core'

