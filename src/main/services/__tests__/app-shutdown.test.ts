import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shutdownMainProcessResources } from '../../app-shutdown'

describe('app shutdown', () => {
  it('disposes the active window watcher subscription', async () => {
    let disposed = false

    await shutdownMainProcessResources({
      activeWindowCleanup: () => {
        disposed = true
      }
    })

    assert.equal(disposed, true)
  })
})
