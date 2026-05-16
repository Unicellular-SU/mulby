import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const pluginWindowSourcePath = join(process.cwd(), 'src/main/plugin/window.ts')
const windowIpcSourcePath = join(process.cwd(), 'src/main/ipc/window.ts')

describe('detached window size pinning', () => {
  it('pins promoted panel windows so Windows titlebar dragging cannot fall back to setPosition drift', () => {
    const source = readFileSync(pluginWindowSourcePath, 'utf8')
    const promoteBranch = source.match(
      /\/\/ 使用 promoteToWindow 将面板升级为独立窗口[\s\S]*?return win\s*\n\s*\}\s*\n\s*\}/
    )

    assert.ok(promoteBranch, 'detachCurrent must handle the promoteToWindow path')
    assert.match(
      promoteBranch[0],
      /const promotedBounds = win\.getBounds\(\)[\s\S]*pinWindowSize\(windowId, promotedBounds\.width, promotedBounds\.height\)/,
      'promoted detached windows must register their actual size before titlebar dragging starts'
    )
    assert.match(
      promoteBranch[0],
      /win\.on\('closed', \(\) => \{[\s\S]*unpinWindowSize\(windowId\)/,
      'promoted detached windows must remove their pinned size when closed'
    )
  })

  it('keeps the pinned size in sync after custom resize drags', () => {
    const source = readFileSync(windowIpcSourcePath, 'utf8')
    const resizeDragHandler = source.match(
      /ipcMain\.on\('window:resizeDrag'[\s\S]*?\n\s*ipcMain\.on\('plugin:reload'/
    )

    assert.ok(resizeDragHandler, 'window:resizeDrag handler must exist')
    assert.match(
      resizeDragHandler[0],
      /const appliedWidth = Math\.max\(1, Math\.round\(clampedWidth\)\)[\s\S]*const appliedHeight = Math\.max\(1, Math\.round\(clampedHeight\)\)[\s\S]*updatePinnedSize\(win\.id, appliedWidth, appliedHeight\)/,
      'custom resize drags must update the pinned size used by later Windows titlebar moves'
    )
  })
})
