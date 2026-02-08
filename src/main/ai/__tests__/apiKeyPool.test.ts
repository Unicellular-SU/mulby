import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getRotatedApiKey, hasApiKey, splitApiKeyString } from '../../../shared/ai/apiKeyPool'

describe('apiKeyPool', () => {
  it('splits comma-separated keys and trims spaces', () => {
    const keys = splitApiKeyString(' key-1 , key-2 , key-3 ')
    assert.deepEqual(keys, ['key-1', 'key-2', 'key-3'])
  })

  it('supports escaped comma and mixed delimiters', () => {
    const keys = splitApiKeyString('k1\\,x，k2\nk3')
    assert.deepEqual(keys, ['k1,x', 'k2', 'k3'])
  })

  it('treats empty/invalid key string as no key', () => {
    assert.equal(hasApiKey(''), false)
    assert.equal(hasApiKey(' , , '), false)
    assert.equal(hasApiKey(undefined), false)
  })

  it('rotates keys in round-robin order under same scope', () => {
    const scope = `scope:${Date.now()}:rr`
    const raw = 'k1,k2,k3'
    assert.equal(getRotatedApiKey(raw, scope), 'k1')
    assert.equal(getRotatedApiKey(raw, scope), 'k2')
    assert.equal(getRotatedApiKey(raw, scope), 'k3')
    assert.equal(getRotatedApiKey(raw, scope), 'k1')
  })

  it('keeps rotation state isolated by scope', () => {
    const raw = 'a,b'
    const scopeA = `scope:${Date.now()}:A`
    const scopeB = `scope:${Date.now()}:B`
    assert.equal(getRotatedApiKey(raw, scopeA), 'a')
    assert.equal(getRotatedApiKey(raw, scopeA), 'b')
    assert.equal(getRotatedApiKey(raw, scopeB), 'a')
  })
})
