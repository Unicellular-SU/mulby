import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

function readFloatingBallCss(): string {
  return readFileSync(resolve(process.cwd(), 'public/floating-ball.css'), 'utf8')
}

function getCssBlock(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`).exec(css)
  assert.ok(match, `missing CSS block for ${selector}`)
  return match[1]
}

describe('floating ball visual design', () => {
  it('sizes the visible ball independently from the padded BrowserWindow viewport', () => {
    const css = readFloatingBallCss()
    const ballRules = getCssBlock(css, '.floating-ball')

    assert.match(css, /--floating-ball-size:\s*52px;/)
    assert.match(css, /--floating-ball-shadow-padding:\s*16px;/)
    assert.match(ballRules, /width:\s*var\(--floating-ball-size\);/)
    assert.match(ballRules, /height:\s*var\(--floating-ball-size\);/)
    assert.doesNotMatch(ballRules, /width:\s*100vw;/)
    assert.doesNotMatch(ballRules, /height:\s*100vh;/)
  })
})
