import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

function readOnboardingCss(): string {
  return readFileSync(resolve(process.cwd(), 'src/renderer/styles/onboarding.css'), 'utf8')
}

function readOnboardingView(): string {
  return readFileSync(resolve(process.cwd(), 'src/renderer/components/OnboardingView.tsx'), 'utf8')
}

function getCssBlock(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`).exec(css)
  assert.ok(match, `Missing CSS block for ${selector}`)
  return match[1]
}

describe('onboarding plugin list css', () => {
  it('uses a dedicated install-page layout instead of the generic centered step', () => {
    const view = readOnboardingView()
    const css = readOnboardingCss()

    assert.match(view, /getStepClass\('plugin-install'\)[^`]*onboarding-step-plugin-install/)
    assert.match(css, /\.onboarding-step-plugin-install\s*\{[\s\S]*?justify-content:\s*flex-start;/)
    assert.match(css, /\.onboarding-plugin-install-scroll\s*\{[\s\S]*?overflow-y:\s*hidden;/)
  })

  it('uses a single readable plugin column in the onboarding window', () => {
    const block = getCssBlock(readOnboardingCss(), '.onboarding-plugin-list')

    assert.match(block, /grid-template-columns:\s*1fr;/)
    assert.doesNotMatch(block, /repeat\(2,\s*1fr\)/)
    assert.match(block, /align-content:\s*start;/)
    assert.match(block, /max-height:\s*none;/)
  })

  it('allows plugin descriptions to wrap to two lines', () => {
    const block = getCssBlock(readOnboardingCss(), '.onboarding-plugin-desc')

    assert.match(block, /-webkit-line-clamp:\s*2;/)
    assert.doesNotMatch(block, /white-space:\s*nowrap;/)
  })

  it('keeps plugin rows tall enough for the title and description', () => {
    const block = getCssBlock(readOnboardingCss(), '.onboarding-plugin-card')

    assert.match(block, /min-height:\s*72px;/)
    assert.match(block, /box-sizing:\s*border-box;/)
  })
})
