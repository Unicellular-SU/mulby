import type { AiInternalToolName } from './internal-tools'
import {
  AI_APPLY_PATCH_TOOL_NAME,
  AI_GIT_DIFF_TOOL_NAME,
  AI_GIT_STATUS_TOOL_NAME,
  AI_HTTP_FETCH_TOOL_NAME,
  AI_LIST_DIR_TOOL_NAME,
  AI_READ_FILE_TOOL_NAME,
  AI_RUN_SCRIPT_TOOL_NAME,
  AI_SEARCH_TEXT_TOOL_NAME,
  normalizeAiInternalToolNames
} from './internal-tools'
import { AI_RUN_COMMAND_TOOL_NAME } from './run-command-tool'

export const AI_TOOL_CAPABILITY_NAMES = [
  'shell.exec',
  'shell.script',
  'fs.read',
  'fs.list',
  'fs.search',
  'patch.apply',
  'http.fetch',
  'git.status',
  'git.diff'
] as const

export type AiToolCapabilityName = typeof AI_TOOL_CAPABILITY_NAMES[number]

const AI_TOOL_CAPABILITY_SET = new Set<string>(AI_TOOL_CAPABILITY_NAMES)

export const AI_HIGH_RISK_CAPABILITIES: AiToolCapabilityName[] = [
  'shell.exec',
  'shell.script',
  'patch.apply',
  'http.fetch',
  'git.status',
  'git.diff'
]

export const AI_DEFAULT_APP_CAPABILITIES: AiToolCapabilityName[] = [...AI_TOOL_CAPABILITY_NAMES]

export const AI_DEFAULT_SKILL_CAPABILITIES: AiToolCapabilityName[] = [...AI_TOOL_CAPABILITY_NAMES]

export const AI_DEFAULT_NETWORK_SKILL_CAPABILITIES: AiToolCapabilityName[] = [
  'fs.read',
  'fs.list',
  'fs.search'
]

function canonicalize(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

const CAPABILITY_ALIAS_MAP: Record<string, AiToolCapabilityName> = {
  shellexec: 'shell.exec',
  shellruncommand: 'shell.exec',
  runcommand: 'shell.exec',
  command: 'shell.exec',
  shell: 'shell.exec',
  shellscript: 'shell.script',
  runscript: 'shell.script',
  fsread: 'fs.read',
  fileread: 'fs.read',
  readfile: 'fs.read',
  fslist: 'fs.list',
  listdir: 'fs.list',
  fssearch: 'fs.search',
  searchtext: 'fs.search',
  patchapply: 'patch.apply',
  applypatch: 'patch.apply',
  httpfetch: 'http.fetch',
  fetchhttp: 'http.fetch',
  gitstatus: 'git.status',
  gitdiff: 'git.diff',
  intoolsruncommand: 'shell.exec',
  intoolsrunscript: 'shell.script',
  intoolsreadfile: 'fs.read',
  intoolslistdir: 'fs.list',
  intoolssearchtext: 'fs.search',
  intoolsapplypatch: 'patch.apply',
  intoolshttpfetch: 'http.fetch',
  intoolsgitstatus: 'git.status',
  intoolsgitdiff: 'git.diff'
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const value = String(item || '').trim()
    if (!value) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function isAiToolCapabilityName(input: string): input is AiToolCapabilityName {
  return AI_TOOL_CAPABILITY_SET.has(String(input || '').trim())
}

export function normalizeAiToolCapabilityNames(input: unknown): AiToolCapabilityName[] {
  const names = normalizeStringList(input)
  const out: AiToolCapabilityName[] = []
  const seen = new Set<AiToolCapabilityName>()
  for (const item of names) {
    const normalized = isAiToolCapabilityName(item)
      ? item
      : CAPABILITY_ALIAS_MAP[canonicalize(item)]
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function mapInternalToolToCapability(name: AiInternalToolName): AiToolCapabilityName | undefined {
  switch (name) {
    case AI_RUN_COMMAND_TOOL_NAME:
      return 'shell.exec'
    case AI_RUN_SCRIPT_TOOL_NAME:
      return 'shell.script'
    case AI_READ_FILE_TOOL_NAME:
      return 'fs.read'
    case AI_LIST_DIR_TOOL_NAME:
      return 'fs.list'
    case AI_SEARCH_TEXT_TOOL_NAME:
      return 'fs.search'
    case AI_APPLY_PATCH_TOOL_NAME:
      return 'patch.apply'
    case AI_HTTP_FETCH_TOOL_NAME:
      return 'http.fetch'
    case AI_GIT_STATUS_TOOL_NAME:
      return 'git.status'
    case AI_GIT_DIFF_TOOL_NAME:
      return 'git.diff'
    default:
      return undefined
  }
}

export function mapInternalToolsToCapabilities(input: unknown): AiToolCapabilityName[] {
  const normalizedInternalTools = normalizeAiInternalToolNames(input)
  const out: AiToolCapabilityName[] = []
  const seen = new Set<AiToolCapabilityName>()
  for (const toolName of normalizedInternalTools) {
    const capability = mapInternalToolToCapability(toolName)
    if (!capability || seen.has(capability)) continue
    seen.add(capability)
    out.push(capability)
  }
  return out
}

function mapCapabilityToInternalTools(capability: AiToolCapabilityName): AiInternalToolName[] {
  switch (capability) {
    case 'shell.exec':
      return [AI_RUN_COMMAND_TOOL_NAME]
    case 'shell.script':
      return [AI_RUN_SCRIPT_TOOL_NAME]
    case 'fs.read':
      return [AI_READ_FILE_TOOL_NAME]
    case 'fs.list':
      return [AI_LIST_DIR_TOOL_NAME]
    case 'fs.search':
      return [AI_SEARCH_TEXT_TOOL_NAME]
    case 'patch.apply':
      return [AI_APPLY_PATCH_TOOL_NAME]
    case 'http.fetch':
      return [AI_HTTP_FETCH_TOOL_NAME]
    case 'git.status':
      return [AI_GIT_STATUS_TOOL_NAME]
    case 'git.diff':
      return [AI_GIT_DIFF_TOOL_NAME]
    default:
      return []
  }
}

export function mapCapabilitiesToInternalToolNames(input: AiToolCapabilityName[]): AiInternalToolName[] {
  const out: AiInternalToolName[] = []
  const seen = new Set<AiInternalToolName>()
  for (const capability of input) {
    const mapped = mapCapabilityToInternalTools(capability)
    for (const toolName of mapped) {
      if (seen.has(toolName)) continue
      seen.add(toolName)
      out.push(toolName)
    }
  }
  return out
}

