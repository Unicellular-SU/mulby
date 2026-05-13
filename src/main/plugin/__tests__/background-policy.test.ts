import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  shouldPreserveBackgroundRunningOnShutdown,
  shouldRestorePersistentBackgroundPlugin,
  supportsBackground
} from '../background-policy'
import type { Plugin } from '../../../shared/types/plugin'

function pluginWithSetting(pluginSetting: NonNullable<Plugin['manifest']['pluginSetting']>, options: {
  enabled?: boolean
  mainPush?: boolean
} = {}): Plugin {
  return {
    id: 'test-plugin',
    path: '/tmp/test-plugin',
    enabled: options.enabled ?? true,
    manifest: {
      name: 'test-plugin',
      version: '1.0.0',
      displayName: 'Test Plugin',
      description: 'Test plugin',
      main: 'dist/main.js',
      pluginSetting,
      features: [
        {
          code: 'main',
          explain: 'Main',
          mainPush: options.mainPush,
          cmds: []
        }
      ]
    }
  }
}

describe('background plugin policy', () => {
  it('treats background as a capability only', () => {
    assert.equal(supportsBackground(pluginWithSetting({ background: true })), true)
    assert.equal(supportsBackground(pluginWithSetting({})), false)
  })

  it('restores only persistent plugins that were running before shutdown', () => {
    const plugin = pluginWithSetting({ background: true, persistent: true })

    assert.equal(shouldRestorePersistentBackgroundPlugin(plugin, { backgroundRunning: true }), true)
    assert.equal(shouldRestorePersistentBackgroundPlugin(plugin, { backgroundRunning: false }), false)
    assert.equal(
      shouldRestorePersistentBackgroundPlugin(pluginWithSetting({ background: true }), { backgroundRunning: true }),
      false
    )
  })

  it('preserves shutdown running state only for persistent background plugins', () => {
    assert.equal(shouldPreserveBackgroundRunningOnShutdown(pluginWithSetting({ background: true, persistent: true })), true)
    assert.equal(shouldPreserveBackgroundRunningOnShutdown(pluginWithSetting({ background: true })), false)
    assert.equal(shouldPreserveBackgroundRunningOnShutdown(pluginWithSetting({ persistent: true })), false)
  })
})
