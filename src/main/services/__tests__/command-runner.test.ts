import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CommandRunnerSettings } from '../../../shared/types/settings'
import { CommandRunnerService } from '../command-runner-core'

function createBaseSettings(): CommandRunnerSettings {
  return {
    enabled: true,
    requireConsent: false,
    allowShell: false,
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 300_000,
    maxOutputBytes: 1024 * 1024,
    maxConcurrent: 2,
    denyEnvKeys: [],
    maskEnvKeysInAudit: [],
    allowList: [],
    denyList: [],
    trustedFingerprints: [],
    audit: {
      maxItems: 500,
      records: []
    }
  }
}

function createInMemoryRunner(input?: {
  settings?: Partial<CommandRunnerSettings>
  consent?: () => Promise<'deny' | 'allow-once' | 'trust'>
}) {
  let nowCounter = 1_700_000_000_000
  let idCounter = 1
  let settings: CommandRunnerSettings = {
    ...createBaseSettings(),
    ...(input?.settings || {})
  }

  const service = new CommandRunnerService({
    getPolicy: () => settings,
    updatePolicy: (next) => {
      settings = next
      return settings
    },
    requestConsent: input?.consent,
    now: () => {
      nowCounter += 10
      return nowCounter
    },
    randomId: () => `r${idCounter++}`
  })

  return {
    service,
    getSettings: () => settings
  }
}

describe('command runner service', () => {
  it('executes allowed command and records audit', async () => {
    const { service, getSettings } = createInMemoryRunner()

    const result = await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("runner-ok")']
      },
      { source: 'app' }
    )

    assert.equal(result.success, true)
    assert.equal(result.stdout, 'runner-ok')
    assert.equal(result.stderr, '')
    assert.equal(getSettings().audit.records.length, 1)
    assert.equal(getSettings().audit.records[0].status, 'allowed')
  })

  it('blocks command in deny list', async () => {
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        denyList: [
          {
            id: 'deny-node',
            mode: 'exact',
            value: process.execPath,
            enabled: true
          }
        ]
      }
    })

    await assert.rejects(
      service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write("blocked")']
        },
        { source: 'app' }
      ),
      /黑名单/
    )

    assert.equal(getSettings().audit.records.length, 1)
    assert.equal(getSettings().audit.records[0].status, 'blocked')
  })

  it('requires plugin permission for plugin source', async () => {
    const { service, getSettings } = createInMemoryRunner()

    await assert.rejects(
      service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write("no-permission")']
        },
        { source: 'plugin', pluginId: 'demo.plugin', runCommandAllowed: false }
      ),
      /未声明 runCommand 权限/
    )

    assert.equal(getSettings().audit.records.length, 1)
    assert.equal(getSettings().audit.records[0].source, 'plugin')
    assert.equal(getSettings().audit.records[0].pluginId, 'demo.plugin')
    assert.equal(getSettings().audit.records[0].status, 'blocked')
  })

  it('supports consent trust flow and reuses trusted fingerprint', async () => {
    let consentCount = 0
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        requireConsent: true
      },
      consent: async () => {
        consentCount += 1
        return 'trust'
      }
    })

    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("trusted")']
      },
      { source: 'app' }
    )
    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("trusted")']
      },
      { source: 'app' }
    )

    assert.equal(consentCount, 1)
    assert.equal(getSettings().trustedFingerprints.length, 1)
    assert.equal(getSettings().audit.records.length, 2)
    assert.equal(getSettings().audit.records[1].status, 'allowed')
  })

  it('marks timeout when command exceeds timeout', async () => {
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        defaultTimeoutMs: 1000,
        maxTimeoutMs: 1000
      }
    })

    const result = await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'setTimeout(() => process.stdout.write("late"), 5000)']
      },
      { source: 'app' }
    )

    assert.equal(result.success, false)
    assert.equal(result.timedOut, true)
    assert.equal(getSettings().audit.records.length, 1)
    assert.equal(getSettings().audit.records[0].status, 'timeout')
  })

  it('blocks denied env keys and masks in audit', async () => {
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        denyEnvKeys: ['SECRET_TOKEN'],
        maskEnvKeysInAudit: ['SECRET_TOKEN']
      }
    })

    await assert.rejects(
      service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.env.SECRET_TOKEN || \"\")'],
          env: { SECRET_TOKEN: 'abc' }
        },
        { source: 'app' }
      ),
      /环境变量命中黑名单/
    )

    assert.equal(getSettings().audit.records.length, 1)
    assert.deepEqual(getSettings().audit.records[0].envKeys, ['SECRET_TOKEN=***'])
    assert.equal(getSettings().audit.records[0].status, 'blocked')
  })
})
