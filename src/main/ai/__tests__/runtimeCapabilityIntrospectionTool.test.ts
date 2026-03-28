import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AiTool } from '../../../shared/types/ai'
import { AI_READ_FILE_TOOL_NAME } from '../tools/internal-tools'
import {
  AI_RUNTIME_CAPABILITY_INTROSPECTION_TOOL_NAME,
  createRuntimeCapabilityIntrospectionSnapshot,
  ensureRuntimeCapabilityIntrospectionTool
} from '../tools/runtime-capability-introspection-tool'

function buildTool(input: {
  name: string
  description?: string
  required?: string[]
}): AiTool {
  return {
    type: 'function',
    function: {
      name: input.name,
      description: input.description || input.name,
      parameters: {
        type: 'object',
        properties: {},
        required: input.required
      }
    }
  }
}

describe('runtime capability introspection tool', () => {
  it('injects introspection tool only when tool list is non-empty', () => {
    const withNoTools = ensureRuntimeCapabilityIntrospectionTool(undefined)
    assert.equal(withNoTools, undefined)

    const tools = [buildTool({ name: AI_READ_FILE_TOOL_NAME })]
    const injected = ensureRuntimeCapabilityIntrospectionTool(tools)
    assert.equal(Array.isArray(injected), true)
    assert.equal(injected?.some((item) => item.function?.name === AI_RUNTIME_CAPABILITY_INTROSPECTION_TOOL_NAME), true)

    const injectedAgain = ensureRuntimeCapabilityIntrospectionTool(injected)
    const count = injectedAgain?.filter((item) => item.function?.name === AI_RUNTIME_CAPABILITY_INTROSPECTION_TOOL_NAME).length
    assert.equal(count, 1)
  })

  it('builds snapshot with tool list, skills, mcp and capabilities summary', () => {
    const tools = ensureRuntimeCapabilityIntrospectionTool([
      buildTool({ name: AI_READ_FILE_TOOL_NAME, description: 'Read file from local workspace', required: ['path'] }),
      buildTool({ name: 'mcp__filesystem__read_file', description: 'Read file from MCP filesystem server' }),
      buildTool({ name: 'custom_search_tool', description: 'Search company knowledge base' })
    ]) || []

    const snapshot = createRuntimeCapabilityIntrospectionSnapshot({
      tools,
      args: { maxTools: 10 },
      capabilityDebug: {
        requested: ['fs.read', 'fs.search'],
        allowed: ['fs.read'],
        denied: ['fs.search'],
        reasons: ['policy:test'],
        selectedSkills: [{ id: 'doc-reader', source: 'system', trustLevel: 'trusted' }]
      },
      policyDebug: {
        skills: {
          requested: { mode: 'manual' },
          selectedSkillIds: ['doc-reader'],
          selectedSkillNames: ['Doc Reader'],
          reasons: ['manual:1']
        },
        mcp: {
          requested: { mode: 'auto' },
          resolved: { mode: 'auto', serverIds: ['filesystem'], allowedToolIds: ['mcp__filesystem__read_file'] }
        },
        toolContext: {
          requested: undefined,
          resolved: { mcpScope: { allowedServerIds: ['filesystem'], allowedToolIds: ['mcp__filesystem__read_file'] } }
        },
        capabilities: {
          requested: ['fs.read', 'fs.search'],
          resolved: ['fs.read']
        },
        internalTools: {
          requested: [AI_READ_FILE_TOOL_NAME],
          resolved: [AI_READ_FILE_TOOL_NAME]
        }
      }
    })

    const summary = snapshot.summary as Record<string, unknown>
    assert.equal(summary.totalTools, 4)
    assert.equal(summary.internalToolCount, 1)
    assert.equal(summary.mcpToolCount, 1)
    assert.equal(summary.customToolCount, 1)
    assert.equal(summary.metaToolCount, 1)

    const toolRows = snapshot.tools as Array<Record<string, unknown>>
    assert.equal(toolRows.some((item) => item.name === AI_RUNTIME_CAPABILITY_INTROSPECTION_TOOL_NAME), true)
    assert.equal(toolRows.some((item) => item.source === 'mcp' && item.serverId === 'filesystem'), true)

    const skills = snapshot.skills as Record<string, unknown>
    assert.deepEqual(skills.selectedSkillNames, ['Doc Reader'])
  })
})
