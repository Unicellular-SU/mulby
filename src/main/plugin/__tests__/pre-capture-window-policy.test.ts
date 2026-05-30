import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldRestoreMainWindowAfterPreCapture } from '../pre-capture-window-policy'

const managerSourcePath = join(process.cwd(), 'src/main/plugin/manager.ts')
const windowSourcePath = join(process.cwd(), 'src/main/plugin/window.ts')

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

  it('restores the host search window before launching an attached UI after successful preCapture', () => {
    const source = readFileSync(managerSourcePath, 'utf8')
    const attachedUiBranch = source.match(/if \(isAttachedUI\) \{[\s\S]*?return \{ success, hasUI: true, uiMode: 'attached' \}/)

    assert.ok(attachedUiBranch, 'attached UI branch must exist')
    assert.match(
      attachedUiBranch[0],
      /feature\?\.preCapture[\s\S]*shouldRestoreMainWindowAfterPreCapture\(\{[\s\S]*mainHide: shouldHideMain,[\s\S]*mainWindowWasVisibleBeforeCapture: mainWindowWasVisibleBeforePreCapture[\s\S]*\}\)[\s\S]*this\.windowManager\.showMainWindowAfterCapture\(\)/,
      'successful preCapture attached launches must restore the host search window before showing the panel'
    )
    assert.match(
      attachedUiBranch[0],
      /showMainWindowAfterCapture\(\)[\s\S]*const success = this\.windowManager\.attachPlugin/,
      'host search window should be restored before attachPlugin starts the async panel show path'
    )
  })

  it('restores opacity when showing the host search window after preCapture', () => {
    const source = readFileSync(windowSourcePath, 'utf8')
    const restoreMethod = source.match(/showMainWindowAfterCapture\(\): void \{[\s\S]*?\n\s*\}/)

    assert.ok(restoreMethod, 'showMainWindowAfterCapture must exist')
    assert.match(
      restoreMethod[0],
      /this\.mainWindow\.setOpacity\(1\)[\s\S]*this\.mainWindow\.show\(\)/,
      'preCapture restore must undo the macOS hide opacity guard before showing the host window'
    )
  })
})
