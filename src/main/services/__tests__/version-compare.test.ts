import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareVersions } from '../../plugin/version'

describe('compareVersions', () => {
  it('compares numeric segments correctly', () => {
    assert.equal(compareVersions('1.2.0', '1.1.9'), 1)
    assert.equal(compareVersions('1.10.0', '1.2.0'), 1)
    assert.equal(compareVersions('2.0.0', '2.0.0'), 0)
    assert.equal(compareVersions('1.0', '1.0.0'), 0)
  })

  it('handles prerelease ordering', () => {
    assert.equal(compareVersions('1.0.0', '1.0.0-beta.1'), 1)
    assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1)
    assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1)
  })

  it('falls back safely for non-semver strings', () => {
    assert.equal(compareVersions('nightly', 'nightly'), 0)
    assert.equal(compareVersions('nightly-2', 'nightly-1'), 1)
  })
})
