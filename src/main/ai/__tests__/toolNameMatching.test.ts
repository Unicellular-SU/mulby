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
  it('maps creator alias to run command when only run command exists', () => {
    const tools = [buildTool('mulby_run_command')]
    const resolved = resolveCompatToolCallName('mulby_creator_run_command', tools)
    assert.equal(resolved, 'mulby_run_command')
  })

  it('returns undefined for ambiguous unknown names', () => {
    const tools = [buildTool('mulby_run_command'), buildTool('mulby_admin_run_command')]
    const resolved = resolveCompatToolCallName('mulby_unknown_run_command', tools)
    assert.equal(resolved, undefined)
  })
})
