import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('UtilityProcess messaging bridge', () => {
  it('keeps messaging handlers inside the worker and delivers bus messages back to them', () => {
    const workerSource = readSource('src/main/plugin/host-worker.ts')
    const protocolSource = readSource('src/main/plugin/host-protocol.ts')
    const managerSource = readSource('src/main/plugin/host-manager.ts')
    const apiSource = readSource('src/main/plugin/api.ts')

    assert.match(protocolSource, /deliverPluginMessage/, 'host protocol should define a worker delivery request')
    assert.match(workerSource, /pluginMessageHandlers/, 'worker should keep plugin message callbacks locally')
    assert.match(workerSource, /messaging\.on/, 'worker should intercept messaging.on instead of serializing callback functions')
    assert.match(workerSource, /handleDeliverPluginMessage/, 'worker should dispatch delivered bus messages to local callbacks')
    assert.match(managerSource, /__plugin_messaging_on__/, 'main process should register a real message-bus handler for worker callbacks')
    assert.match(managerSource, /deliverPluginMessage/, 'main process handler should forward bus messages back to the worker')
    assert.match(apiSource, /messageBus\.subscribe\(pluginName, handler\)/, 'main PluginAPI should still register handlers on the shared bus')
  })

  it('keeps the loaded module when the same plugin is initialized repeatedly', () => {
    const workerSource = readSource('src/main/plugin/host-worker.ts')

    assert.match(workerSource, /samePlugin/, 'worker init should detect repeated init for the same plugin')
    assert.match(workerSource, /const currentModule = samePlugin \? previousPluginState\.module : null/, 'worker init should keep the current module for repeated init')
    assert.match(workerSource, /module:\s*currentModule/, 'repeated init should preserve the current module instance')
  })
})
