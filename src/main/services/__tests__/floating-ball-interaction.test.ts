import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const floatingBallScriptPath = join(process.cwd(), 'public/floating-ball.js')

describe('floating ball pointer interaction', () => {
  it('starts region capture as soon as the long-press threshold is reached', () => {
    const source = readFileSync(floatingBallScriptPath, 'utf8')
    const pointerDownHandler = source.match(/ball\.addEventListener\('pointerdown'[\s\S]*?\n\}\)/)
    const pointerMoveHandler = source.match(/ball\.addEventListener\('pointermove'[\s\S]*?\n\}\)/)
    const pointerUpHandler = source.match(/ball\.addEventListener\('pointerup'[\s\S]*?\n\}\)/)

    assert.ok(pointerDownHandler, 'pointerdown handler must exist')
    assert.ok(pointerMoveHandler, 'pointermove handler must exist')
    assert.ok(pointerUpHandler, 'pointerup handler must exist')
    assert.match(source, /let longPressTriggered = false/)
    assert.match(source, /function releaseActivePointerCapture\(\) \{[\s\S]*releasePointerCapture/)
    assert.match(
      pointerDownHandler[0],
      /finishPointerAction\(\)[\s\S]*api\.longPress\(\)/,
      'long press timer should release the floating ball pointer state and enter capture mode immediately'
    )
    assert.match(
      pointerDownHandler[0],
      /isPointerDown = false[\s\S]*longPressTriggered = true[\s\S]*lastClickAt = 0/,
      'long press timer must reset click state before the window is hidden or recreated'
    )
    assert.match(
      pointerMoveHandler[0],
      /if \(longPressTriggered\) return/,
      'movement after the long-press threshold must not turn into a drag'
    )
    assert.doesNotMatch(
      pointerUpHandler[0],
      /api\.longPress\(\)/,
      'pointerup must not be required to enter region capture after a long press'
    )
  })
})
