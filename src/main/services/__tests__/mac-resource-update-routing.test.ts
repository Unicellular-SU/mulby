import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldUseMacResourceUpdatesForRuntime } from '../mac-resource-update'

describe('mac resource update routing', () => {
  it('routes packaged macOS builds to resource updates only', () => {
    assert.equal(shouldUseMacResourceUpdatesForRuntime('darwin', true), true)
    assert.equal(shouldUseMacResourceUpdatesForRuntime('darwin', false), false)
    assert.equal(shouldUseMacResourceUpdatesForRuntime('win32', true), false)
    assert.equal(shouldUseMacResourceUpdatesForRuntime('linux', true), false)
  })
})
