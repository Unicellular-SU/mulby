import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createEndChunk,
  createErrorChunk,
  createReasoningChunk,
  createTextChunk,
  createToolCallChunk,
  createToolResultChunk
} from '../streamChunkProtocol'
import { summarizeStreamChunks } from '../streamRegressionScenarios'
import type { AiMessage } from '../../../shared/types/ai'

describe('stream regression scenarios', () => {
  it('multi-step tool flow: preserves tool call/result order and completes', () => {
    const chunks: AiMessage[] = [
      createReasoningChunk('先算加法。'),
      createToolCallChunk({ id: 'call_1', name: 'sumNumbers', args: { a: 12, b: 30 } }),
      createToolResultChunk({ id: 'call_1', name: 'sumNumbers', result: { result: 42 } }),
      createReasoningChunk('再查询系统信息。'),
      createToolCallChunk({ id: 'call_2', name: 'getSystemInfo', args: {} }),
      createToolResultChunk({ id: 'call_2', name: 'getSystemInfo', result: { platform: 'darwin' } }),
      createTextChunk('计算结果:42；系统信息:darwin'),
      createEndChunk({ role: 'assistant', usage: { inputTokens: 100, outputTokens: 50 } })
    ]
    const summary = summarizeStreamChunks(chunks)
    assert.equal(summary.status, 'completed')
    assert.equal(summary.toolCalls.length, 2)
    assert.equal(summary.toolResults.length, 2)
    assert.equal(summary.toolCalls[0]?.id, 'call_1')
    assert.equal(summary.toolResults[1]?.id, 'call_2')
    assert.match(summary.text, /计算结果:42/)
    assert.match(summary.reasoning, /再查询系统信息/)
    assert.deepEqual(summary.warnings, [])
  })

  it('reasoning + text interleaving: aggregates into separate channels', () => {
    const chunks: AiMessage[] = [
      createReasoningChunk('思考A '),
      createTextChunk('回答A '),
      createReasoningChunk('思考B '),
      createTextChunk('回答B '),
      createEndChunk({ role: 'assistant' })
    ]
    const summary = summarizeStreamChunks(chunks)
    assert.equal(summary.status, 'completed')
    assert.equal(summary.reasoning, '思考A 思考B ')
    assert.equal(summary.text, '回答A 回答B ')
    assert.deepEqual(summary.warnings, [])
  })

  it('exception interruption: moves to error state and records message', () => {
    const chunks: AiMessage[] = [
      createTextChunk('partial'),
      createErrorChunk(new Error('upstream 500')),
      createTextChunk('should-not-append')
    ]
    const summary = summarizeStreamChunks(chunks)
    assert.equal(summary.status, 'error')
    assert.match(summary.errorMessage || '', /500/)
    assert.equal(summary.text, 'partial')
    assert.ok(summary.warnings.some((item) => item.includes('after terminal state')))
  })

  it('abort scenario: classifies abort/cancel as aborted', () => {
    const chunks: AiMessage[] = [
      createTextChunk('partial'),
      createErrorChunk(new Error('Request aborted by user')),
      createEndChunk({ role: 'assistant' })
    ]
    const summary = summarizeStreamChunks(chunks)
    assert.equal(summary.status, 'aborted')
    assert.match(summary.errorMessage || '', /aborted/i)
    assert.equal(summary.text, 'partial')
    assert.ok(summary.warnings.some((item) => item.includes('after terminal state')))
  })
})

