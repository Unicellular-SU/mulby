import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const floatingBallManagerSourcePath = join(process.cwd(), 'src/main/services/floating-ball-manager.ts')

describe('floating ball context menu', () => {
  it('keeps the floating ball out of taskbar/dock surfaces while the native menu is open', () => {
    const source = readFileSync(floatingBallManagerSourcePath, 'utf8')

    assert.match(
      source,
      /private popupNativeContextMenu\(menu: Menu\): void/,
      'floating ball should isolate native menu popup focus handling in a helper'
    )
    assert.match(
      source,
      /const keepFloatingBallOutOfTaskbar = \(\) => \{[\s\S]*win\.setSkipTaskbar\(true\)/,
      'floating ball should explicitly stay out of taskbar-like surfaces while showing a menu'
    )
    assert.match(
      source,
      /process\.platform !== 'win32'[\s\S]*menu\.popup\(\{ window: win, callback: restoreMenuWindowChrome \}\)/,
      'macOS and Linux should not temporarily focus the floating ball for native menus'
    )
    assert.match(
      source,
      /process\.platform === 'win32'[\s\S]*win\.setFocusable\(true\)[\s\S]*keepFloatingBallOutOfTaskbar\(\)[\s\S]*win\.focus\(\)[\s\S]*keepFloatingBallOutOfTaskbar\(\)[\s\S]*menu\.popup\(\{[\s\S]*window: win[\s\S]*callback: restoreMenuWindowChrome/,
      'Windows native menu popup should use a foreground focusable owner without showing a taskbar icon'
    )
    assert.match(
      source,
      /const restoreMenuWindowChrome = \(\) => \{[\s\S]*keepFloatingBallOutOfTaskbar\(\)[\s\S]*win\.setFocusable\(false\)/,
      'floating ball should restore non-focusable and hidden-taskbar behavior when the native menu closes'
    )
  })
})
