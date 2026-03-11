import { commandRunnerService } from './command-runner'
import type { RunCommandInput, RunCommandResult } from './command-runner-core'

export function runCommandAsApp(input: RunCommandInput): Promise<RunCommandResult> {
  return commandRunnerService.runCommand(input, {
    source: 'app',
    assumeUserApproved: true
  })
}
