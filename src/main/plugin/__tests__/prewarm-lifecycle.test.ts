import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const managerSourcePath = join(process.cwd(), 'src/main/plugin/manager.ts')
const hostManagerSourcePath = join(process.cwd(), 'src/main/plugin/host-manager.ts')

function readSource(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('plugin prewarm lifecycle', () => {
  it('keeps prewarm cleanup from destroying hosts with in-flight initialization', () => {
    const managerSource = readSource(managerSourcePath)
    const hostManagerSource = readSource(hostManagerSourcePath)

    const initializePlugin = managerSource.match(
      /async initializePlugin\(name: string\): Promise<void> \{[\s\S]*?\n[ ]{2}\}\n\n[ ]{2}\/\/ 销毁所有资源/
    )
    const destroyUnusedPrewarmHost = managerSource.match(
      /private destroyUnusedPrewarmHost\(pluginId: string\): void \{[\s\S]*?\n[ ]{2}\}\n\n[ ]{2}\/\/ ==================== Resident UI Session/
    )

    assert.ok(initializePlugin, 'initializePlugin should exist')
    assert.ok(destroyUnusedPrewarmHost, 'destroyUnusedPrewarmHost should exist')
    assert.match(
      initializePlugin[0],
      /await this\.ensurePluginLoaded\(plugin, plugin\.id\)/,
      'active initialization should share the loading promise used by normal plugin launch'
    )
    assert.match(
      destroyUnusedPrewarmHost[0],
      /this\.hostManager\.hasActiveRequests\(pluginId\)/,
      'prewarm cleanup should not destroy a host with pending requests'
    )
    assert.match(
      managerSource,
      /const hasActiveHostRequests = this\.hostManager\.hasActiveRequests\(pluginId\)/,
      'generic runtime-demand checks should treat pending host requests as active runtime demand'
    )
    assert.match(
      hostManagerSource,
      /hasActiveRequests\(pluginName: string\): boolean/,
      'host manager should expose pending request state for lifecycle guards'
    )
    assert.match(
      hostManagerSource,
      /Skip destroying active host/,
      'host manager should guard non-forced destroy requests while a request is in flight'
    )
    assert.match(
      hostManagerSource,
      /reason: 'idle-timeout'/,
      'host manager cleanup callers should label destroy requests for diagnosis'
    )
  })
})
