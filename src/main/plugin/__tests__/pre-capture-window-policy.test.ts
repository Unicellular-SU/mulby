import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldRestoreMainWindowAfterPreCapture } from '../pre-capture-window-policy'

const managerSourcePath = join(process.cwd(), 'src/main/plugin/manager.ts')

describe('preCapture main window restoration policy', () => {
  it('does not restore the host search window when capture was launched while hidden', () => {
    assert.equal(
      shouldRestoreMainWindowAfterPreCapture({
        mainHide: false,
        mainWindowWasVisibleBeforeCapture: false
      }),
      false
    )
  })

  it('restores the host search window only when it was visible before capture', () => {
    assert.equal(
      shouldRestoreMainWindowAfterPreCapture({
        mainHide: false,
        mainWindowWasVisibleBeforeCapture: true
      }),
      true
    )
    assert.equal(
      shouldRestoreMainWindowAfterPreCapture({
        mainHide: true,
        mainWindowWasVisibleBeforeCapture: true
      }),
      false
    )
  })

  it('uses preCapture visibility state in plugin launch cancellation paths', () => {
    const source = readFileSync(managerSourcePath, 'utf8')
    const cancellationBranch = source.match(/if \(!capturedDataUrl\) \{[\s\S]*?return \{ success: false, error: 'Capture cancelled' \}/)
    const failureBranch = source.match(/catch \(err\) \{[\s\S]*?preCapture failed[\s\S]*?\n\s*\}\n\s*\}/)

    assert.match(
      source,
      /mainWindowWasVisibleBeforePreCapture = this\.windowManager\?\.isMainWindowVisible\(\) === true/,
      'preCapture should snapshot main window visibility before hiding it'
    )
    assert.ok(cancellationBranch, 'preCapture cancellation branch must exist')
    assert.ok(failureBranch, 'preCapture failure branch must exist')
    assert.match(
      cancellationBranch[0],
      /shouldRestoreMainWindowAfterPreCapture\(\{[\s\S]*mainHide: shouldHideMain,[\s\S]*mainWindowWasVisibleBeforeCapture: mainWindowWasVisibleBeforePreCapture[\s\S]*\}\)/,
      'cancelled preCapture should restore only if the host window was previously visible'
    )
    assert.match(
      failureBranch[0],
      /shouldRestoreMainWindowAfterPreCapture\(\{[\s\S]*mainHide: shouldHideMain,[\s\S]*mainWindowWasVisibleBeforeCapture: mainWindowWasVisibleBeforePreCapture[\s\S]*\}\)/,
      'failed preCapture should restore only if the host window was previously visible'
    )
  })
})
