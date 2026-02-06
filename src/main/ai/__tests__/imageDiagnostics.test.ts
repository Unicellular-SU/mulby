import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyAiImageError } from '../../../shared/ai/imageDiagnostics'

describe('imageDiagnostics', () => {
  it('marks 5xx as retryable by default', () => {
    const classified = classifyAiImageError({ message: 'upstream failed', statusCode: 502 })
    assert.equal(classified.code, 'AI_IMAGE_HTTP_5XX')
    assert.equal(classified.retryable, true)
    assert.equal(classified.statusCode, 502)
  })

  it('keeps common 4xx non-retryable unless explicitly retryable', () => {
    const classified = classifyAiImageError({ message: 'bad request', statusCode: 400 })
    assert.equal(classified.code, 'AI_IMAGE_HTTP_4XX')
    assert.equal(classified.retryable, false)
    assert.equal(classified.statusCode, 400)
  })

  it('treats network/socket interruptions as retryable', () => {
    const classified = classifyAiImageError(new Error('fetch failed: ECONNRESET'))
    assert.equal(classified.code, 'AI_IMAGE_NETWORK')
    assert.equal(classified.retryable, true)
  })

  it('treats successful-response parse interruptions as retryable network errors', () => {
    const error = {
      message: 'Failed to process successful response',
      statusCode: 200,
      cause: {
        message: 'terminated',
        cause: {
          code: 'UND_ERR_SOCKET',
          message: 'other side closed'
        }
      }
    }
    const classified = classifyAiImageError(error)
    assert.equal(classified.code, 'AI_IMAGE_NETWORK')
    assert.equal(classified.retryable, true)
    assert.equal(classified.statusCode, 200)
  })

  it('never retries abort-like failures', () => {
    const classified = classifyAiImageError(new Error('request aborted by user'))
    assert.equal(classified.code, 'AI_IMAGE_ABORTED')
    assert.equal(classified.retryable, false)
  })
})
