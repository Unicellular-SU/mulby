import type { CommandExecutionProfile } from '../../shared/types/settings'
import type { PluginPermissions } from '../../shared/types/plugin'

export interface ResolvedCommandExecutionPermission {
  allowed: boolean
  defaultProfile?: CommandExecutionProfile
  maxProfile?: CommandExecutionProfile
}

function normalizeProfile(value: unknown): CommandExecutionProfile | undefined {
  return value === 'sandbox' || value === 'workspace' || value === 'trusted'
    ? value
    : undefined
}

export function resolveDirectCommandExecutionPermission(
  permissions: PluginPermissions | undefined
): ResolvedCommandExecutionPermission {
  const direct = permissions?.commandExecution?.direct
  const legacyAllowed = permissions?.runCommand === true
  const allowed = direct?.enabled === true || legacyAllowed
  const legacyOnly = legacyAllowed && direct?.enabled !== true
  return {
    allowed,
    defaultProfile: normalizeProfile(direct?.defaultProfile) || (allowed ? legacyOnly ? 'trusted' : 'workspace' : undefined),
    maxProfile: normalizeProfile(direct?.maxProfile) || (allowed ? legacyOnly ? 'trusted' : 'workspace' : undefined)
  }
}

export function resolveAiCommandExecutionPermission(
  permissions: PluginPermissions | undefined
): ResolvedCommandExecutionPermission {
  const ai = permissions?.commandExecution?.ai
  const allowed = ai?.enabled === true
  return {
    allowed,
    defaultProfile: normalizeProfile(ai?.defaultProfile) || (allowed ? 'sandbox' : undefined),
    maxProfile: normalizeProfile(ai?.maxProfile) || (allowed ? 'sandbox' : undefined)
  }
}
