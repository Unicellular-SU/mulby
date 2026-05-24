import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const titlebarViewSourcePath = join(process.cwd(), 'src/main/plugin/titlebar-view.ts')

describe('detached titlebar layout', () => {
  it('keeps plugin WebContentsView inside the visible surface below the custom titlebar', () => {
    const source = readFileSync(titlebarViewSourcePath, 'utf8')

    assert.match(
      source,
      /getWindowsFramelessSurfaceInsets/,
      'detached titlebar layout should account for Windows frameless surface insets'
    )
    assert.match(
      source,
      /const \{ top, right, bottom, left \} = getWindowsFramelessSurfaceInsets\(\)/,
      'layout should read the same surface insets used by the titlebar host page'
    )
    assert.match(
      source,
      /x: left[\s\S]*y: top \+ titleBarHeight[\s\S]*width: Math\.max\(1, contentWidth - left - right\)[\s\S]*height: Math\.max\(1, contentHeight - top - bottom - titleBarHeight\)/,
      'plugin view must align with the titlebar visible width and start below the inset titlebar'
    )
  })
})
