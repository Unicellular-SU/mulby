import type { AiTool } from '../../../shared/types/ai'
import { AI_RUN_COMMAND_TOOL_NAME, buildAiRunCommandTool } from './run-command-tool'

export const AI_READ_FILE_TOOL_NAME = 'mulby_read_file'
export const AI_LIST_DIR_TOOL_NAME = 'mulby_list_dir'
export const AI_SEARCH_TEXT_TOOL_NAME = 'mulby_search_text'
export const AI_APPLY_PATCH_TOOL_NAME = 'mulby_apply_patch'
export const AI_HTTP_FETCH_TOOL_NAME = 'mulby_http_fetch'
export const AI_WEB_SEARCH_TOOL_NAME = 'mulby_web_search'
export const AI_WEB_FETCH_TOOL_NAME = 'mulby_web_fetch'
export const AI_RUN_SCRIPT_TOOL_NAME = 'mulby_run_script'
export const AI_GIT_STATUS_TOOL_NAME = 'mulby_git_status'
export const AI_GIT_DIFF_TOOL_NAME = 'mulby_git_diff'
export const AI_ACTIVATE_SKILL_TOOL_NAME = 'mulby_activate_skill'

export const AI_INTERNAL_TOOL_NAMES = [
  AI_RUN_COMMAND_TOOL_NAME,
  AI_READ_FILE_TOOL_NAME,
  AI_LIST_DIR_TOOL_NAME,
  AI_SEARCH_TEXT_TOOL_NAME,
  AI_APPLY_PATCH_TOOL_NAME,
  AI_HTTP_FETCH_TOOL_NAME,
  AI_WEB_SEARCH_TOOL_NAME,
  AI_WEB_FETCH_TOOL_NAME,
  AI_RUN_SCRIPT_TOOL_NAME,
  AI_GIT_STATUS_TOOL_NAME,
  AI_GIT_DIFF_TOOL_NAME,
  AI_ACTIVATE_SKILL_TOOL_NAME
] as const

export type AiInternalToolName = typeof AI_INTERNAL_TOOL_NAMES[number]

const INTERNAL_TOOL_NAME_SET = new Set<string>(AI_INTERNAL_TOOL_NAMES)

function canonicalToolName(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

const INTERNAL_TOOL_ALIAS_CANONICAL_MAP: Record<string, AiInternalToolName> = {
  runcommand: AI_RUN_COMMAND_TOOL_NAME,
  shellruncommand: AI_RUN_COMMAND_TOOL_NAME,
  mulbyruncommand: AI_RUN_COMMAND_TOOL_NAME
}

function normalizeToolList(input: unknown): string[] {
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

export function isAiInternalToolName(input: string): input is AiInternalToolName {
  return INTERNAL_TOOL_NAME_SET.has(String(input || '').trim())
}

export function normalizeAiInternalToolNames(input: unknown): AiInternalToolName[] {
  const names = normalizeToolList(input)
  const out: AiInternalToolName[] = []
  const seen = new Set<AiInternalToolName>()
  for (const item of names) {
    const normalized = isAiInternalToolName(item)
      ? item
      : INTERNAL_TOOL_ALIAS_CANONICAL_MAP[canonicalToolName(item)]
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function createInternalTool(input: {
  name: AiInternalToolName
  description: string
  properties: Record<string, unknown>
  required?: string[]
}): AiTool {
  return {
    type: 'function',
    function: {
      name: input.name,
      description: input.description,
      parameters: {
        type: 'object',
        properties: input.properties,
        required: input.required,
        additionalProperties: false
      }
    }
  }
}

export function buildAiInternalTool(name: AiInternalToolName): AiTool {
  switch (name) {
    case AI_RUN_COMMAND_TOOL_NAME:
      return buildAiRunCommandTool()
    case AI_READ_FILE_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Read a local file with optional byte limit and encoding.',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path.' },
          encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'Response encoding. Default utf-8.' },
          maxBytes: { type: 'number', description: 'Optional maximum bytes to read.' }
        }
      })
    case AI_LIST_DIR_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'List files/directories in a local path with optional recursion.',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Directory path.' },
          recursive: { type: 'boolean', description: 'Whether to list recursively.' },
          maxEntries: { type: 'number', description: 'Optional max returned entries.' },
          includeStat: { type: 'boolean', description: 'Whether to include stat info per entry.' }
        }
      })
    case AI_SEARCH_TEXT_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Search plain text in files under a root directory.',
        required: ['rootPath', 'query'],
        properties: {
          rootPath: { type: 'string', description: 'Search root directory.' },
          query: { type: 'string', description: 'Text to search.' },
          glob: { type: 'string', description: 'Optional glob-like file filter (supports *).' },
          caseSensitive: { type: 'boolean', description: 'Case-sensitive match.' },
          maxResults: { type: 'number', description: 'Optional max matched lines.' }
        }
      })
    case AI_APPLY_PATCH_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Validate or apply a unified diff patch in a repository directory.',
        required: ['patch'],
        properties: {
          patch: { type: 'string', description: 'Unified diff patch text.' },
          baseDir: { type: 'string', description: 'Optional working directory for patch apply.' },
          mode: { type: 'string', enum: ['dry-run', 'apply'], description: 'dry-run validates patch; apply writes changes.' },
          dryRunToken: { type: 'string', description: 'Token returned by previous dry-run when required.' }
        }
      })
    case AI_HTTP_FETCH_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Execute an HTTP request with policy checks and response size limits.',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'HTTP/HTTPS URL.' },
          method: { type: 'string', description: 'HTTP method. Default GET.' },
          headers: { type: 'object', description: 'Optional request headers.' },
          body: { type: 'string', description: 'Optional request body string.' },
          timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds.' },
          maxBytes: { type: 'number', description: 'Optional max response body bytes.' }
        }
      })
    case AI_RUN_SCRIPT_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Run a pre-registered script by scriptId.',
        required: ['scriptId'],
        properties: {
          scriptId: { type: 'string', description: 'Registered script id.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Optional script args.' },
          env: { type: 'object', description: 'Optional script env variables.' },
          timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds.' }
        }
      })
    case AI_GIT_STATUS_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Get git status for a repository path.',
        required: ['repoPath'],
        properties: {
          repoPath: { type: 'string', description: 'Repository path.' },
          short: { type: 'boolean', description: 'Return short status format.' }
        }
      })
    case AI_GIT_DIFF_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Get git diff for working tree/staged/commit target.',
        required: ['repoPath'],
        properties: {
          repoPath: { type: 'string', description: 'Repository path.' },
          target: { type: 'string', enum: ['working', 'staged', 'commit'], description: 'Diff target. Default working.' },
          ref: { type: 'string', description: 'Commit ref for target=commit. Default HEAD.' },
          maxBytes: { type: 'number', description: 'Optional max output bytes.' }
        }
      })
    case AI_ACTIVATE_SKILL_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Load the full instructions for an agent skill. Call this when a task matches a skill\'s description in the available_skills list. Returns the skill body content with structured context.',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Skill name from the <available_skills> list.' }
        }
      })
    case AI_WEB_SEARCH_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Search the internet for current information, news, documentation, and real-time data. Returns structured results with titles, URLs, and content snippets in Markdown format.',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search query string.' },
          maxResults: { type: 'number', description: 'Max number of results. Default 5.' },
          language: { type: 'string', description: 'Preferred language for results, e.g. zh-CN, en. Optional.' }
        }
      })
    case AI_WEB_FETCH_TOOL_NAME:
      return createInternalTool({
        name,
        description: 'Fetch a web page URL and extract its main content as clean Markdown text. Ideal for reading articles, documentation, and web pages. Strips ads, navigation, and other noise. Always returns Markdown format.',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'HTTP/HTTPS URL to fetch.' },
          maxLength: { type: 'number', description: 'Max content length in characters. Default 8000.' }
        }
      })
    default:
      return buildAiRunCommandTool()
  }
}

export function buildAiInternalTools(names: AiInternalToolName[]): AiTool[] {
  return names.map((name) => buildAiInternalTool(name))
}
