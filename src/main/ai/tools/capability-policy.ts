import type { AiOption, AiSkillSelectionMeta } from '../../../shared/types/ai'
import type { AiToolCapabilityPolicySettings, AiToolCapabilityGrant } from '../../../shared/types/settings'
import {
  AI_DEFAULT_APP_CAPABILITIES,
  AI_DEFAULT_NETWORK_SKILL_CAPABILITIES,
  AI_DEFAULT_SKILL_CAPABILITIES,
  normalizeAiToolCapabilityNames,
  type AiToolCapabilityName
} from './capabilities'

interface NormalizedAiCapabilityPolicy {
  defaultAppCapabilities: AiToolCapabilityName[]
  defaultSkillCapabilities: AiToolCapabilityName[]
  defaultNetworkSkillCapabilities: AiToolCapabilityName[]
  grants: AiToolCapabilityGrant[]
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

const NETWORK_SKILL_SOURCES = new Set(['zip', 'json'])

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
    const id = String(row.id || `${decision}:${capability}:${row.skillId || row.source || ''}`).trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      capability,
      decision,
      skillId: String(row.skillId || '').trim() || undefined,
      source: String(row.source || '').trim() as AiToolCapabilityGrant['source'],
      createdAt: Number(row.createdAt) || undefined,
      updatedAt: Number(row.updatedAt) || undefined,
      expiresAt: Number(row.expiresAt) || undefined
    })
  }
  return out
}

function normalizePolicy(input: Partial<AiToolCapabilityPolicySettings> | undefined): NormalizedAiCapabilityPolicy {
  return {
    defaultAppCapabilities: normalizeAiToolCapabilityNames(input?.defaultAppCapabilities || AI_DEFAULT_APP_CAPABILITIES),
    defaultSkillCapabilities: normalizeAiToolCapabilityNames(input?.defaultSkillCapabilities || AI_DEFAULT_SKILL_CAPABILITIES),
    defaultNetworkSkillCapabilities: normalizeAiToolCapabilityNames(
      input?.defaultNetworkSkillCapabilities || AI_DEFAULT_NETWORK_SKILL_CAPABILITIES
    ),
    grants: normalizeGrants(input?.grants)
  }
}

function isNetworkSkill(skill: AiSkillSelectionMeta): boolean {
  if (!skill) return false
  if (skill.trustLevel === 'untrusted') return true
  return NETWORK_SKILL_SOURCES.has(skill.source)
}

function grantApplies(
  grant: AiToolCapabilityGrant,
  capability: AiToolCapabilityName,
  selectedSkills: AiSkillSelectionMeta[]
): boolean {
  if (!grant || grant.capability !== capability) return false
  if (grant.skillId) {
    return selectedSkills.some((skill) => skill.id === grant.skillId)
  }
  if (grant.source) {
    return selectedSkills.some((skill) => skill.source === grant.source)
  }
  return true
}

export function resolveAiCapabilityPolicy(input: ResolveAiCapabilityPolicyInput): ResolveAiCapabilityPolicyResult {
  const selectedSkills = input.selectedSkills || []
  const normalizedPolicy = normalizePolicy(input.policy)
  const now = input.now || Date.now()
  const hasNetworkSkill = selectedSkills.some((skill) => isNetworkSkill(skill))
  const baseline = new Set<AiToolCapabilityName>(
    hasNetworkSkill
      ? normalizedPolicy.defaultNetworkSkillCapabilities
      : selectedSkills.length > 0
        ? normalizedPolicy.defaultSkillCapabilities
        : normalizedPolicy.defaultAppCapabilities
  )

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
  const grants = normalizedPolicy.grants.filter((grant) => !grant.expiresAt || grant.expiresAt > now)

  const allowedCapabilities: AiToolCapabilityName[] = []
  const deniedCapabilities: AiToolCapabilityName[] = []
  const reasons: string[] = []

  for (const capability of requested) {
    if (sessionDeny.has(capability)) {
      deniedCapabilities.push(capability)
      reasons.push(`${capability}: denied by session`)
      continue
    }

    const deniedByGrant = grants.some((grant) => grant.decision === 'deny' && grantApplies(grant, capability, selectedSkills))
    if (deniedByGrant) {
      deniedCapabilities.push(capability)
      reasons.push(`${capability}: denied by policy`)
      continue
    }

    const allowedByGrant = grants.some((grant) => grant.decision === 'allow' && grantApplies(grant, capability, selectedSkills))
    const allowedBySession = sessionAllow.has(capability)
    const allowedByBaseline = baseline.has(capability)

    if (allowedByGrant || allowedBySession || allowedByBaseline) {
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
