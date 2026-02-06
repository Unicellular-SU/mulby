import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyAiStreamError } from '../../../shared/ai/streamDiagnostics'

describe('streamDiagnostics', () => {
  it('classifies abort errors', () => {
    const classified = classifyAiStreamError(new Error('Request aborted by user'))
    assert.equal(classified.code, 'AI_STREAM_ABORTED')
    assert.equal(classified.category, 'abort')
    assert.equal(classified.retryable, false)
  })

  it('classifies tool-loop and tool execution failures', () => {
    const maxSteps = classifyAiStreamError(new Error('Tool execution exceeded maxToolSteps (5)'))
    assert.equal(maxSteps.code, 'AI_STREAM_TOOL_MAX_STEPS_EXCEEDED')

    const toolError = classifyAiStreamError(new Error('[AI_TOOL_EXECUTION_ERROR] sumNumbers: timeout'))
    assert.equal(toolError.code, 'AI_STREAM_TOOL_EXECUTION_ERROR')
  })

  it('classifies capability blocking and missing executor', () => {
    const capability = classifyAiStreamError(new Error('Model does not support web_search capability'))
    assert.equal(capability.code, 'AI_STREAM_MODEL_CAPABILITY_BLOCKED')

    const missingExecutor = classifyAiStreamError(new Error('AI tool executor is not configured'))
    assert.equal(missingExecutor.code, 'AI_STREAM_TOOL_EXECUTOR_MISSING')
  })

  it('reads statusCode/retryable from provider-like errors', () => {
    const from5xx = classifyAiStreamError({
      message: 'upstream failed',
      statusCode: 502,
      isRetryable: true
    })
    assert.equal(from5xx.code, 'AI_STREAM_HTTP_5XX')
    assert.equal(from5xx.statusCode, 502)
    assert.equal(from5xx.retryable, true)

    const from4xx = classifyAiStreamError({
      message: 'bad request',
      statusCode: 400,
      isRetryable: false
    })
    assert.equal(from4xx.code, 'AI_STREAM_HTTP_4XX')
    assert.equal(from4xx.statusCode, 400)
    assert.equal(from4xx.retryable, false)
  })

  it('falls back to message parsing/network detection', () => {
    const parsedHttp = classifyAiStreamError(new Error('HTTP 429 Too Many Requests'))
    assert.equal(parsedHttp.code, 'AI_STREAM_HTTP_4XX')
    assert.equal(parsedHttp.statusCode, 429)
    assert.equal(parsedHttp.retryable, true)

    const network = classifyAiStreamError(new Error('fetch failed: ECONNRESET'))
    assert.equal(network.code, 'AI_STREAM_NETWORK')
    assert.equal(network.retryable, true)
  })
})

