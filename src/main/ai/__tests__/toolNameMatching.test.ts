import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveCompatToolCallName } from '../tool-name-matching'
import type { AiTool } from '../../../shared/types/ai'

function buildTool(name: string): AiTool {
  return {
    type: 'function',
    function: {
      name,
      description: name,
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
}

describe('tool name matching', () => {
  it('maps creator alias to declared skill creator tool', () => {
    const tools = [buildTool('intools_skill_creator_run_command')]
    const resolved = resolveCompatToolCallName('intools_creator_run_command', tools)
    assert.equal(resolved, 'intools_skill_creator_run_command')
  })

  it('returns undefined for ambiguous unknown names', () => {
    const tools = [buildTool('intools_run_command'), buildTool('intools_skill_creator_run_command')]
    const resolved = resolveCompatToolCallName('intools_unknown_run_command', tools)
    assert.equal(resolved, undefined)
  })
})

