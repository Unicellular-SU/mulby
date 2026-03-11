import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeSha256Hex,
  getStoreTransportPolicy,
  isAllowedStoreTransport,
  normalizeSha256
} from '../../plugin/store-security'

describe('plugin store security helpers', () => {
  it('allows HTTPS and localhost HTTP transports only', () => {
    assert.equal(getStoreTransportPolicy('https://example.com/store.json'), 'secure')
    assert.equal(getStoreTransportPolicy('http://localhost:4173/store.json'), 'local-http')
    assert.equal(getStoreTransportPolicy('http://127.0.0.1:4173/store.json'), 'local-http')
    assert.equal(getStoreTransportPolicy('http://example.com/store.json'), 'insecure')
    assert.equal(isAllowedStoreTransport('https://example.com/store.json'), true)
    assert.equal(isAllowedStoreTransport('http://localhost:4173/store.json'), true)
    assert.equal(isAllowedStoreTransport('http://example.com/store.json'), false)
  })

  it('normalizes sha256 values and rejects malformed digests', () => {
    const digest = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    assert.equal(normalizeSha256(`sha256:${digest.toUpperCase()}`), digest)
    assert.equal(normalizeSha256(digest), digest)
    assert.equal(normalizeSha256('abc123'), undefined)
  })

  it('computes deterministic sha256 digests', () => {
    assert.equal(
      computeSha256Hex(Buffer.from('mulby-plugin', 'utf8')),
      '90c023c069a246e1600e00020b0aa1d859c24c58d83fcc1ad1f6fda0a4a20ec6'
    )
  })
})
