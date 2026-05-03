import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAuxiliaryLoadFileOptions, parseAuxiliaryPath } from '../window-path'

describe('auxiliary window path parsing', () => {
  it('normalizes route-only auxiliary paths to hash routes', () => {
    assert.deepEqual(parseAuxiliaryPath('overlay'), { hash: 'overlay' })
    assert.deepEqual(parseAuxiliaryPath('/overlay'), { hash: 'overlay' })
    assert.deepEqual(parseAuxiliaryPath('#overlay'), { hash: 'overlay' })
    assert.deepEqual(parseAuxiliaryPath('#/overlay'), { hash: 'overlay' })
  })

  it('splits legacy html, hash route, and query strings for loadFile', () => {
    assert.deepEqual(parseAuxiliaryPath('/index.html#overlay'), { hash: 'overlay' })
    assert.deepEqual(parseAuxiliaryPath('overlay?a=1&b=2'), { hash: 'overlay', search: '?a=1&b=2' })
    assert.deepEqual(parseAuxiliaryPath('/index.html#overlay?a=1'), { hash: 'overlay', search: '?a=1' })
    assert.deepEqual(parseAuxiliaryPath('/index.html?mode=pin&img=abc'), { search: '?mode=pin&img=abc' })
    assert.deepEqual(parseAuxiliaryPath('/index.html?mode=pin#overlay'), { hash: 'overlay', search: '?mode=pin' })
  })

  it('omits empty loadFile options', () => {
    assert.equal(createAuxiliaryLoadFileOptions(parseAuxiliaryPath('/index.html')), undefined)
  })
})
