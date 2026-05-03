import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createEndChunk,
  createErrorChunk,
  createMetaChunk,
  createReasoningChunk,
  createTextChunk,
  createToolCallChunk,
  createToolProgressChunk,
  createToolResultChunk
} from '../streamChunkProtocol'

describe('streamChunkProtocol', () => {
  it('creates text chunk with standardized chunkType', () => {
    const chunk = createTextChunk('hello')
    assert.equal(chunk.chunkType, 'text')
    assert.equal(chunk.content, 'hello')
  })

  it('creates reasoning chunk with standardized chunkType', () => {
    const chunk = createReasoningChunk('think')
    assert.equal(chunk.chunkType, 'reasoning')
    assert.equal(chunk.reasoning_content, 'think')
  })

  it('creates meta chunk for capability debug payload', () => {
    const chunk = createMetaChunk({
      capability_debug: {
        requested: ['shell.exec'],
        allowed: ['shell.exec'],
        denied: [],
        reasons: ['allowed by policy']
      },
      policy_debug: {
        skills: {
          requested: { mode: 'manual', skillIds: ['debug-skill'] },
          selectedSkillIds: ['debug-skill'],
          selectedSkillNames: ['Debug Skill'],
          reasons: ['manual:1']
        },
        mcp: {
          requested: { mode: 'manual', serverIds: ['filesystem'] },
          resolved: { mode: 'manual', serverIds: ['filesystem'] }
        },
        toolContext: {
          requested: { pluginName: 'ai-api-test' },
          resolved: { pluginName: 'ai-api-test' }
        },
        capabilities: {
          requested: [],
          resolved: []
        },
        internalTools: {
          requested: [],
          resolved: []
        }
      }
    })
    assert.equal(chunk.chunkType, 'meta')
    assert.deepEqual(chunk.capability_debug?.requested, ['shell.exec'])
    assert.deepEqual(chunk.policy_debug?.skills.selectedSkillIds, ['debug-skill'])
  })

  it('creates tool call/result chunks', () => {
    const callChunk = createToolCallChunk({ id: 'c1', name: 'sumNumbers', args: { a: 1, b: 2 } })
    assert.equal(callChunk.chunkType, 'tool-call')
    assert.equal(callChunk.tool_call?.name, 'sumNumbers')

    const progressChunk = createToolProgressChunk({
      id: 'c1',
      name: 'sumNumbers',
      progress: 1,
      total: 2,
      message: 'Adding numbers'
    })
    assert.equal(progressChunk.chunkType, 'tool-progress')
    assert.equal(progressChunk.tool_progress?.progress, 1)
    assert.equal(progressChunk.tool_progress?.total, 2)
    assert.equal(progressChunk.tool_progress?.message, 'Adding numbers')

    const resultChunk = createToolResultChunk({ id: 'c1', name: 'sumNumbers', result: { result: 3 } })
    assert.equal(resultChunk.chunkType, 'tool-result')
    const toolResult = resultChunk.tool_result?.result
    assert.equal(
      typeof toolResult === 'object' && toolResult ? (toolResult as { result?: number }).result : undefined,
      3
    )
  })

  it('creates error chunk and end chunk (without duplicated content payload)', () => {
    const errorChunk = createErrorChunk(new Error('boom'))
    assert.equal(errorChunk.chunkType, 'error')
    assert.equal(errorChunk.error?.message, 'boom')
    assert.equal(errorChunk.error?.code, undefined)

    const classifiedErrorChunk = createErrorChunk(new Error('bad gateway'), {
      code: 'AI_STREAM_HTTP_5XX',
      category: 'http',
      retryable: true,
      statusCode: 502,
      message: 'HTTP 502 Bad Gateway'
    })
    assert.equal(classifiedErrorChunk.error?.code, 'AI_STREAM_HTTP_5XX')
    assert.equal(classifiedErrorChunk.error?.statusCode, 502)
    assert.equal(classifiedErrorChunk.error?.retryable, true)

    const endChunk = createEndChunk({
      role: 'assistant',
      content: 'final',
      reasoning_content: 'reasoning',
      usage: { inputTokens: 1, outputTokens: 2 }
    })
    assert.equal(endChunk.chunkType, 'end')
    assert.deepEqual(endChunk.usage, { inputTokens: 1, outputTokens: 2 })
    assert.equal(endChunk.content, undefined)
    assert.equal(endChunk.reasoning_content, undefined)
  })
})
