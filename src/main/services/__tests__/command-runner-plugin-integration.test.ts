import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CommandRunnerSettings } from '../../../shared/types/settings'
import { CommandRunnerService } from '../command-runner-core'

function createSettings(): CommandRunnerSettings {
  return {
    enabled: true,
    requireConsent: false,
    allowShell: false,
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 300_000,
    maxOutputBytes: 1024 * 1024,
    maxConcurrent: 2,
    maxQueueSize: 20,
    denyEnvKeys: [],
    maskEnvKeysInAudit: [],
    allowList: [],
    denyList: [],
    trustedFingerprints: [],
    sandbox: {
      enabled: true,
      backendMode: 'policy',
      fallbackToPolicy: true,
      allowedRoots: [process.cwd()],
      writableRoots: [process.cwd()],
      networkAllowed: false
    },
    audit: {
      maxItems: 500,
      records: []
    }
  }
}

function createRunner() {
  let settings = createSettings()
  const service = new CommandRunnerService({
    getPolicy: () => settings,
    updatePolicy: (next) => {
      settings = next
      return settings
    }
  })
  return {
    service,
    getSettings: () => settings
  }
}

describe('command runner plugin integration', () => {
  it('runs plugin command and filters plugin audit records', async () => {
    const { service } = createRunner()

    const pluginResult = await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("plugin-ok")']
      },
      {
        source: 'plugin',
        pluginId: 'plugin.alpha',
        runCommandAllowed: true
      }
    )

    assert.equal(pluginResult.success, true)
    assert.equal(pluginResult.stdout, 'plugin-ok')

    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("app-ok")']
      },
      { source: 'app' }
    )

    const pluginAudit = service.listAudit(20, 'plugin.alpha')
    assert.equal(pluginAudit.length, 1)
    assert.equal(pluginAudit[0].source, 'plugin')
    assert.equal(pluginAudit[0].pluginId, 'plugin.alpha')
    assert.equal(pluginAudit[0].status, 'allowed')
  })

  it('clears audit by plugin id without affecting app records', async () => {
    const { service, getSettings } = createRunner()

    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("plugin-a")']
      },
      {
        source: 'plugin',
        pluginId: 'plugin.a',
        runCommandAllowed: true
      }
    )
    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("plugin-b")']
      },
      {
        source: 'plugin',
        pluginId: 'plugin.b',
        runCommandAllowed: true
      }
    )
    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("app")']
      },
      { source: 'app' }
    )

    const before = getSettings().audit.records.length
    assert.equal(before, 3)

    service.clearAudit('plugin.a')
    const after = getSettings().audit.records
    assert.equal(after.length, 2)
    assert.equal(after.some((item) => item.pluginId === 'plugin.a'), false)
    assert.equal(after.some((item) => item.pluginId === 'plugin.b'), true)
    assert.equal(after.some((item) => item.source === 'app'), true)
  })
})
