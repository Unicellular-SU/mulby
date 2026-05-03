import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { routeHostToolProgress } from '../host-progress'
import type { ToolProgressResponse } from '../host-protocol'

describe('host tool progress routing', () => {
  it('routes toolProgress messages to the pending request callback', () => {
    const received: ToolProgressResponse['payload'][] = []
    const host = {
      pendingRequests: new Map<string, {
        onToolProgress?: (progress: ToolProgressResponse['payload']) => void
      }>()
    }

    host.pendingRequests.set('request-1', {
      onToolProgress: (progress) => received.push(progress)
    })

    const message: ToolProgressResponse = {
      id: 'request-1',
      type: 'toolProgress',
      payload: {
        toolName: 'long_task',
        callId: 'request-1',
        progress: 2,
        total: 5,
        message: 'Processing',
        timestamp: 123
      }
    }

    routeHostToolProgress(host, message)

    assert.equal(received.length, 1)
    assert.deepEqual(received[0], message.payload)
  })
})
