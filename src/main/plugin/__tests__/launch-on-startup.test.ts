import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const repoRoot = process.cwd()

function readSource(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf-8')
}

describe('launch on startup policy', () => {
  it('restricts launch-on-startup IPC to app windows', () => {
    const source = readSource('src/main/ipc/plugin.ts')

    assert.match(source, /plugin:getLaunchOnStartup', appOnlyInvoke/)
    assert.match(source, /'plugin:setLaunchOnStartup',\s*appOnlyInvoke/s)
  })

  it('restores launch-on-startup plugins as background workers plus hidden UI cache', () => {
    const source = readSource('src/main/plugin/manager.ts')
    const match = source.match(/private launchUserStartupPlugins\(\): void \{([\s\S]*?)\n {2}\}/)
    assert.ok(match, 'launchUserStartupPlugins should exist')

    const body = match[1]
    assert.match(body, /backgroundManager\.start\(plugin, true\)/)
    assert.match(body, /ensurePluginLoaded\(plugin, plugin\.id\)/)
    assert.match(body, /cacheLaunchOnStartupUi\(plugin, state\)/)
    assert.doesNotMatch(body, /this\.run\(/)
    assert.doesNotMatch(body, /createDetachedWindow|attachPlugin/)
  })

  it('stores launch-on-startup state as background plus selected UI target', () => {
    const source = readSource('src/main/plugin/state.ts')

    assert.match(source, /mode: 'background'/)
    assert.match(source, /featureCode/)
    assert.match(source, /route/)
    assert.match(source, /uiMode/)
  })

  it('creates startup UI cache hidden instead of showing panels or detached windows', () => {
    const source = readSource('src/main/plugin/window.ts')

    assert.match(source, /createHiddenResidentPanel/)
    assert.match(source, /createHiddenResidentDetachedWindow/)
    assert.match(source, /restoreDetachedIfResident/)
    assert.match(source, /hiddenResident: true/)
  })

  it('raises resident-ui cache limit to six entries', () => {
    const source = readSource('src/main/plugin/manager.ts')

    assert.match(source, /RESIDENT_UI_CACHE_LIMIT = 6/)
  })
})
