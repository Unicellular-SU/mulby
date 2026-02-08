import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildMcpToolId, isMcpToolName } from '../mcp'

describe('mcp service helpers', () => {
  it('builds canonical MCP tool ids', () => {
    const toolId = buildMcpToolId('weather', 'forecast')
    assert.equal(toolId, 'mcp__weather__forecast')
  })

  it('detects MCP tool id prefix', () => {
    assert.equal(isMcpToolName('mcp__server__tool'), true)
    assert.equal(isMcpToolName('sumNumbers'), false)
  })
})
