import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveAuxiliaryWindowSizeLimits } from '../auxiliary-window-options'
import type { WindowOptions } from '../../../shared/types/plugin'

const manifestWindowConfig: WindowOptions = {
  width: 400,
  height: 560,
  minWidth: 360,
  minHeight: 480,
  maxWidth: 520,
  maxHeight: 720,
  type: 'borderless',
  titleBar: false
}

describe('auxiliary window size limits', () => {
  it('does not inherit manifest window size limits by default', () => {
    assert.deepEqual(resolveAuxiliaryWindowSizeLimits(undefined, manifestWindowConfig), {})
    assert.deepEqual(resolveAuxiliaryWindowSizeLimits({}, manifestWindowConfig), {})
  })

  it('uses child window size limits from create options', () => {
    assert.deepEqual(resolveAuxiliaryWindowSizeLimits({
      minWidth: 100,
      minHeight: 80,
      maxWidth: 1280,
      maxHeight: 720
    }, manifestWindowConfig), {
      minWidth: 100,
      minHeight: 80,
      maxWidth: 1280,
      maxHeight: 720
    })
  })

  it('inherits manifest limits only when explicitly requested', () => {
    assert.deepEqual(resolveAuxiliaryWindowSizeLimits({
      inheritWindowSizeLimits: true
    }, manifestWindowConfig), {
      minWidth: 360,
      minHeight: 480,
      maxWidth: 520,
      maxHeight: 720
    })
  })

  it('lets explicit child limits override inherited manifest limits', () => {
    assert.deepEqual(resolveAuxiliaryWindowSizeLimits({
      inheritWindowSizeLimits: true,
      maxWidth: 1920,
      maxHeight: 1080
    }, manifestWindowConfig), {
      minWidth: 360,
      minHeight: 480,
      maxWidth: 1920,
      maxHeight: 1080
    })
  })
})
