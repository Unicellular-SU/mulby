import type { AppSettings, CommandRunnerSettings } from '../../shared/types/settings'
import { appSettingsManager } from './app-settings'
import { showInternalMessageBox } from './ui-dialog-service'
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

async function requestConsentByInternalUi(request: CommandConsentRequest): Promise<CommandConsentDecision> {
  const result = await showInternalMessageBox({
    type: 'warning',
    title: request.title,
    message: request.message,
    detail: request.detail,
    buttons: ['拒绝', '仅本次允许', '信任并允许'],
    defaultId: 0,
    cancelId: 0
  })
  if (result.response === 2) return 'trust'
  if (result.response === 1) return 'allow-once'
  return 'deny'
}

export const commandRunnerService = new CommandRunnerService({
  getPolicy: () => appSettingsManager.getSettings().commandRunner,
  updatePolicy: updateCommandRunnerSettings,
  requestConsent: requestConsentByInternalUi
})

export {
  CommandRunnerService
}
export type {
  RunCommandInput,
  RunCommandResult,
  RunCommandContext
} from './command-runner-core'
