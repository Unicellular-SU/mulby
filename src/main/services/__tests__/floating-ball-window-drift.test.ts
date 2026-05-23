import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const floatingBallManagerSourcePath = join(process.cwd(), 'src/main/services/floating-ball-manager.ts')

describe('floating ball window movement', () => {
  it('pins the transparent frameless window size and moves with setBounds on Windows', () => {
    const source = readFileSync(floatingBallManagerSourcePath, 'utf8')

    assert.match(source, /pinWindowSize\(/, 'floating ball windows must register their actual size')
    assert.match(source, /unpinWindowSize\(/, 'floating ball windows must clear the pinned size on close')
    assert.match(source, /updatePinnedSize\(/, 'floating ball windows must update the pin after a real resize')
    assert.match(
      source,
      /private moveWindow[\s\S]*process\.platform === 'win32'[\s\S]*getPinnedSize\([\s\S]*?\.id\)[\s\S]*?setBounds\(\{ x:[\s\S]*?width: pinned\.width,[\s\S]*?height: pinned\.height[\s\S]*?\}/,
      'Windows-only moves must use setBounds with the pinned size instead of bare setPosition'
    )
  })

  it('recreates the Windows floating window around native region capture', () => {
    const source = readFileSync(floatingBallManagerSourcePath, 'utf8')

    assert.match(
      source,
      /private suspendWindowForRegionCapture\(\): void \{[\s\S]*process\.platform === 'win32'[\s\S]*this\.destroyWindow\(\)/,
      'Windows native region capture must destroy the transparent floating window instead of reusing it after hide/show'
    )
    assert.match(
      source,
      /private async restoreWindowAfterRegionCapture\(\): Promise<void> \{[\s\S]*await this\.ensureWindow\(\)/,
      'the floating ball must be recreated after native region capture so Chromium input state is fresh'
    )
  })
})
