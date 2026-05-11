import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isInBrowserFunctionSource } from '../InBrowserWindow'

describe('InBrowser function source detection', () => {
  it('accepts function declarations, async functions, arrows, and async arrows', () => {
    assert.equal(isInBrowserFunctionSource('function () { return true }'), true)
    assert.equal(isInBrowserFunctionSource('async function () { return true }'), true)
    assert.equal(isInBrowserFunctionSource('() => true'), true)
    assert.equal(isInBrowserFunctionSource('async () => true'), true)
    assert.equal(isInBrowserFunctionSource('(value) => Boolean(value)'), true)
    assert.equal(isInBrowserFunctionSource('value => Boolean(value)'), true)
  })

  it('keeps selector strings as selectors', () => {
    assert.equal(isInBrowserFunctionSource('#search'), false)
    assert.equal(isInBrowserFunctionSource('.card[data-kind="=>"]'), false)
    assert.equal(isInBrowserFunctionSource('button.function-link'), false)
  })
})
