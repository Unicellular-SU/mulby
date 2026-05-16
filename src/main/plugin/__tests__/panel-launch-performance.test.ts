import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const panelWindowSourcePath = join(process.cwd(), 'src/main/plugin/panel-window.ts')

describe('attached panel launch performance', () => {
  it('does not block first panel show on plugin content surface injection', () => {
    const source = readFileSync(panelWindowSourcePath, 'utf8')
    const didFinishLoadHandler = source.match(
      /capturedWebContents\.on\('did-finish-load'[\s\S]*?\n\s*\}\)/
    )
    const showPanelFunction = source.match(
      /const showPanel = async \(reason: string\) => \{[\s\S]*?\n\s*\}\s*\n\s*\n\s*capturedWebContents\.once\('dom-ready'/
    )

    assert.ok(didFinishLoadHandler, 'attached panel did-finish-load handler must exist')
    assert.ok(showPanelFunction, 'attached panel showPanel function must exist')
    assert.match(
      source,
      /private panelShellSurfacePromise: Promise<void> \| null = null/,
      'attached panel shell surface should be cached with the reusable shell window'
    )
    assert.match(
      source,
      /if \(this\.panelShellSurfacePromise\) return this\.panelShellSurfacePromise/,
      'attached panel shell surface should reuse the initialized or in-flight shell surface'
    )
    assert.match(
      source,
      /this\.panelShellSurfacePromise = \(async \(\) => \{/,
      'attached panel shell surface should initialize through the cached promise'
    )
    assert.match(
      source,
      /const ensureAttachedPluginContentSurface = \(\): Promise<void>/,
      'plugin content surface injection should be an explicit deferred operation'
    )
    assert.doesNotMatch(
      didFinishLoadHandler[0],
      /await ensureAttachedPluginContentSurface\(/,
      'did-finish-load must not await plugin content surface injection before showing the panel'
    )
    assert.match(
      showPanelFunction[0],
      /capturedWin\.show\(\)[\s\S]*void ensureAttachedPluginContentSurface\(\)/,
      'plugin content surface injection should start after the panel is shown'
    )
    const temporaryDiagnosticsPattern = new RegExp(
      ['PanelLaunch', 'Trace'].join('') + '|' + ['tracePanel', 'Launch'].join('')
    )
    assert.doesNotMatch(
      source,
      temporaryDiagnosticsPattern,
      'temporary panel launch diagnostics should not be left in production code'
    )
  })
})
