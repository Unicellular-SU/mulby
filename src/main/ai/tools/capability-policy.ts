import type { AiOption, AiSkillSelectionMeta } from '../../../shared/types/ai'
import type { AiToolCapabilityPolicySettings, AiToolCapabilityGrant } from '../../../shared/types/settings'
import {
  AI_DEFAULT_APP_CAPABILITIES,
  normalizeAiToolCapabilityNames,
  type AiToolCapabilityName
} from './capabilities'

interface NormalizedAiCapabilityPolicy {
  defaultAppCapabilities: AiToolCapabilityName[]
  globalGrants: AiToolCapabilityGrant[]
}

export interface ResolveAiCapabilityPolicyInput {
  option: AiOption
  requestedCapabilities: AiToolCapabilityName[]
  selectedSkills?: AiSkillSelectionMeta[]
  policy?: Partial<AiToolCapabilityPolicySettings>
  now?: number
}

export interface ResolveAiCapabilityPolicyResult {
  allowedCapabilities: AiToolCapabilityName[]
  deniedCapabilities: AiToolCapabilityName[]
  reasons: string[]
}

function normalizeGrants(input: unknown): AiToolCapabilityGrant[] {
  if (!Array.isArray(input)) return []
  const out: AiToolCapabilityGrant[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const capability = String(row.capability || '').trim()
    const decision = row.decision === 'deny' ? 'deny' : row.decision === 'allow' ? 'allow' : undefined
    if (!capability || !decision) continue
    const id = String(row.id || `${decision}:${capability}`).trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      capability,
      decision,
      createdAt: Number(row.createdAt) || undefined,
      updatedAt: Number(row.updatedAt) || undefined,
      expiresAt: Number(row.expiresAt) || undefined
    })
  }
  return out
}

// System-level capabilities that must always be in the baseline regardless of
// user settings. These are internal mechanics the user shouldn't need to manage.
// Regular tool capabilities (shell.exec, fs.read, etc.) are NOT listed here —
// users can remove them from defaultAppCapabilities via Settings.
const SYSTEM_REQUIRED_CAPABILITIES: AiToolCapabilityName[] = ['skill.activate']

function normalizePolicy(input: Partial<AiToolCapabilityPolicySettings> | undefined): NormalizedAiCapabilityPolicy {
  // Use stored settings if explicitly set (including empty array = user cleared all).
  // Fall back to code defaults only when the field is not provided at all.
  // Then ensure system-required capabilities are always present (settings migration).
  const stored = input?.defaultAppCapabilities
  const base = Array.isArray(stored) ? stored : AI_DEFAULT_APP_CAPABILITIES
  const defaultAppCapabilities = normalizeAiToolCapabilityNames([
    ...base,
    ...SYSTEM_REQUIRED_CAPABILITIES
  ])
  const globalGrants = normalizeGrants(input?.globalGrants)
  return {
    defaultAppCapabilities,
    globalGrants
  }
}

export function resolveAiCapabilityPolicy(input: ResolveAiCapabilityPolicyInput): ResolveAiCapabilityPolicyResult {
  const normalizedPolicy = normalizePolicy(input.policy)
  const now = input.now || Date.now()
  const baseline = new Set<AiToolCapabilityName>(normalizedPolicy.defaultAppCapabilities)

  const requestedSet = new Set<AiToolCapabilityName>(input.requestedCapabilities || [])
  const hasCustomTools = Array.isArray(input.option.tools) && input.option.tools.length > 0
  if (
    requestedSet.size === 0 &&
    !hasCustomTools &&
    input.option.toolingPolicy?.enableInternalTools !== false
  ) {
    for (const capability of baseline) {
      requestedSet.add(capability)
    }
  }

  const requested = Array.from(requestedSet)
  if (requested.length === 0) {
    return {
      allowedCapabilities: [],
      deniedCapabilities: [],
      reasons: ['no requested capabilities']
    }
  }

  const sessionAllow = new Set<AiToolCapabilityName>(normalizeAiToolCapabilityNames(input.option.toolingPolicy?.capabilityAllowList || []))
  const sessionDeny = new Set<AiToolCapabilityName>(normalizeAiToolCapabilityNames(input.option.toolingPolicy?.capabilityDenyList || []))
  const globalGrants = normalizedPolicy.globalGrants.filter((grant) => !grant.expiresAt || grant.expiresAt > now)

  const allowedCapabilities: AiToolCapabilityName[] = []
  const deniedCapabilities: AiToolCapabilityName[] = []
  const reasons: string[] = []

  for (const capability of requested) {
    if (sessionDeny.has(capability)) {
      deniedCapabilities.push(capability)
      reasons.push(`${capability}: denied by session`)
      continue
    }

    const deniedByGlobalGrant = globalGrants.some((grant) => grant.decision === 'deny' && grant.capability === capability)
    if (deniedByGlobalGrant) {
      deniedCapabilities.push(capability)
      reasons.push(`${capability}: denied by global grant`)
      continue
    }

    const allowedByGlobalGrant = globalGrants.some((grant) => grant.decision === 'allow' && grant.capability === capability)
    const allowedBySession = sessionAllow.has(capability)
    const allowedByBaseline = baseline.has(capability)

    if (allowedBySession) {
      allowedCapabilities.push(capability)
      continue
    }

    if (allowedByGlobalGrant || allowedByBaseline) {
      allowedCapabilities.push(capability)
      continue
    }

    deniedCapabilities.push(capability)
    reasons.push(`${capability}: blocked by default policy`)
  }

  return {
    allowedCapabilities,
    deniedCapabilities,
    reasons
  }
}
