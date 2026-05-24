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
      /private popupNativeContextMenu\(menu: Menu, consumePendingMenuAction\?: \(\) => \(\(\) => void\) \| null\): void/,
      'floating ball should isolate native menu popup focus handling in a helper'
    )
    assert.match(
      source,
      /const keepFloatingBallOutOfTaskbar = \(\) => \{[\s\S]*win\.setSkipTaskbar\(true\)/,
      'floating ball should explicitly stay out of taskbar-like surfaces while showing a menu'
    )
    assert.match(
      source,
      /process\.platform !== 'win32'[\s\S]*menu\.popup\(\{ window: win, callback: completeMenu \}\)/,
      'macOS and Linux should not temporarily focus the floating ball for native menus and should still complete deferred actions'
    )
    assert.match(
      source,
      /process\.platform === 'win32'[\s\S]*win\.setFocusable\(true\)[\s\S]*keepFloatingBallOutOfTaskbar\(\)[\s\S]*win\.focus\(\)[\s\S]*keepFloatingBallOutOfTaskbar\(\)[\s\S]*menu\.popup\(\{[\s\S]*window: win[\s\S]*callback: completeMenu/,
      'Windows native menu popup should use a foreground focusable owner without showing a taskbar icon'
    )
    assert.match(
      source,
      /const restoreMenuWindowChrome = \(\) => \{[\s\S]*keepFloatingBallOutOfTaskbar\(\)[\s\S]*win\.setFocusable\(false\)/,
      'floating ball should restore non-focusable and hidden-taskbar behavior when the native menu closes'
    )
  })

  it('defers focus-changing menu actions until after the native menu owner is restored', () => {
    const source = readFileSync(floatingBallManagerSourcePath, 'utf8')

    assert.match(
      source,
      /let pendingMenuAction: \(\(\) => void\) \| null = null/,
      'native menu actions should be captured for execution after the menu closes'
    )
    assert.match(
      source,
      /const runAfterMenuClosed = \(action: \(\) => void\) => \{[\s\S]*pendingMenuAction = action[\s\S]*\}/,
      'focus-changing actions should be wrapped instead of running from the native menu click stack'
    )
    assert.match(
      source,
      /label: mainVisible \? '隐藏 Mulby' : '显示 Mulby'[\s\S]*click: \(\) => runAfterMenuClosed\(\(\) => this\.handleClick\(\)\)/,
      'show/hide Mulby should run only after the floating-ball menu has closed'
    )
    assert.match(
      source,
      /const action = pendingMenuAction[\s\S]*pendingMenuAction = null[\s\S]*restoreMenuWindowChrome\(\)[\s\S]*if \(action\) \{[\s\S]*setTimeout\(action, 0\)/,
      'the menu callback should restore non-focusable chrome before running the deferred action'
    )
  })
})
