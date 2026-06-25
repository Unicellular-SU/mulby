import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const panelWindowSourcePath = join(process.cwd(), 'src/main/plugin/panel-window.ts')
const pluginApiSourcePath = join(process.cwd(), 'src/preload/apis/app-plugin-api.ts')

function extractPromoteMethod(source: string): string {
  const promoteMethod = source.match(
    /promoteToWindow\(\): PromotedPanelWindow \| null \{[\s\S]*?return \{ window: independentWindow, pluginView \}/
  )
  assert.ok(promoteMethod, 'promoteToWindow method must exist')
  return promoteMethod[0]
}

describe('detached promotion preserves plugin runtime state', () => {
  it('broadcasts a lightweight mode change instead of a state-resetting plugin:init when promoting', () => {
    const source = readFileSync(panelWindowSourcePath, 'utf8')
    const promoteMethod = extractPromoteMethod(source)

    // promoteToWindow reuses the same WebContentsView (renderer is not reloaded),
    // so the plugin's live state must NOT be clobbered by re-sending plugin:init.
    assert.doesNotMatch(
      promoteMethod,
      /pluginWebContents\.send\('plugin:init'/,
      'promoting to a detached window must NOT re-send plugin:init (would reset user input)'
    )

    assert.match(
      promoteMethod,
      /pluginWebContents\.send\('plugin:mode-changed', \{[\s\S]*mode: 'detached'/,
      'promoting must notify the plugin via plugin:mode-changed'
    )
  })

  it('does not carry input/route in the mode change payload', () => {
    const source = readFileSync(panelWindowSourcePath, 'utf8')
    const promoteMethod = extractPromoteMethod(source)

    const modeChangePayload = promoteMethod.match(
      /pluginWebContents\.send\('plugin:mode-changed', \{[\s\S]*?\}\)/
    )
    assert.ok(modeChangePayload, 'mode change payload must exist')
    assert.doesNotMatch(
      modeChangePayload[0],
      /\binput\b|\battachments\b|\broute\b/,
      'mode change payload must not carry input/attachments/route so state is preserved'
    )
  })

  it('exposes onModeChange in the plugin preload API', () => {
    const source = readFileSync(pluginApiSourcePath, 'utf8')

    assert.match(
      source,
      /onModeChange:/,
      'preload should expose onModeChange for plugins that want to react to mode switches'
    )
    assert.match(
      source,
      /ipcRenderer\.on\('plugin:mode-changed', listener\)/,
      'onModeChange must subscribe to the plugin:mode-changed channel'
    )
  })
})
