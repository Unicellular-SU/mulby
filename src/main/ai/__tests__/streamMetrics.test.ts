import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createAiStreamMetrics,
  finishAiStreamMetricsError,
  finishAiStreamMetricsSuccess,
  markAiStreamRoute,
  recordAiStreamChunk
} from '../streamMetrics'

describe('streamMetrics', () => {
  it('records chunk counters and route', () => {
    const metrics = createAiStreamMetrics({
      requestId: 'req_1',
      providerType: 'deepseek',
      model: 'deepseek:deepseek-reasoner',
      hasTools: true,
      compatToolLoop: true,
      maxToolSteps: 5
    })
    markAiStreamRoute(metrics, 'openai-compat-tool-loop')
    recordAiStreamChunk(metrics, { role: 'assistant', chunkType: 'reasoning', reasoning_content: 'think' })
    recordAiStreamChunk(metrics, { role: 'assistant', chunkType: 'text', content: 'answer' })
    recordAiStreamChunk(metrics, { role: 'assistant', chunkType: 'tool-call', tool_call: { id: '1', name: 'sum' } })
    recordAiStreamChunk(metrics, { role: 'assistant', chunkType: 'tool-result', tool_result: { id: '1', name: 'sum' } })
    recordAiStreamChunk(metrics, { role: 'assistant', chunkType: 'end' })

    assert.equal(metrics.route, 'openai-compat-tool-loop')
    assert.equal(metrics.chunks.reasoning, 1)
    assert.equal(metrics.chunks.text, 1)
    assert.equal(metrics.chunks.toolCall, 1)
    assert.equal(metrics.chunks.toolResult, 1)
    assert.equal(metrics.chunks.end, 1)
    assert.equal(metrics.reasoningChars, 5)
    assert.equal(metrics.textChars, 6)
  })

  it('finalizes completed/error states', () => {
    const metrics = createAiStreamMetrics({
      requestId: 'req_2',
      providerType: 'openai',
      model: 'openai:gpt-4o-mini',
      hasTools: false,
      compatToolLoop: false,
      maxToolSteps: 10
    })
    const completed = finishAiStreamMetricsSuccess(metrics, { inputTokens: 10, outputTokens: 5 })
    assert.equal(completed.status, 'completed')
    assert.equal(completed.usage?.inputTokens, 10)
    assert.ok((completed.durationMs || 0) >= 0)

    const aborted = finishAiStreamMetricsError(metrics, {
      code: 'AI_STREAM_ABORTED',
      category: 'abort',
      retryable: false,
      message: 'aborted'
    })
    assert.equal(aborted.status, 'aborted')
    assert.equal(aborted.error?.code, 'AI_STREAM_ABORTED')
  })
})

