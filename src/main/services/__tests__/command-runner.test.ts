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

  it('supports consent trust flow and reuses trusted prefix across different args', async () => {
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

    // 第一次执行：触发 consent
    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("first")']
      },
      { source: 'app' }
    )

    // 第二次执行：相同 command 但不同 args，应该自动通过（前缀匹配）
    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("second")']
      },
      { source: 'app' }
    )

    // 第三次执行：完全不同的 args
    await service.runCommand(
      {
        command: process.execPath,
        args: ['--version']
      },
      { source: 'app' }
    )

    // consent 应只被调用一次（第一次），后续通过前缀匹配自动信任
    assert.equal(consentCount, 1)
    assert.equal(getSettings().trustedFingerprints.length, 1)
    assert.ok(getSettings().trustedFingerprints[0].prefix)
    assert.equal(getSettings().audit.records.length, 3)
    assert.equal(getSettings().audit.records[1].status, 'allowed')
    assert.equal(getSettings().audit.records[2].status, 'allowed')
  })

  it('isolates trust by pluginId', async () => {
    let consentCount = 0
    const { service } = createInMemoryRunner({
      settings: {
        requireConsent: true
      },
      consent: async () => {
        consentCount += 1
        return 'trust'
      }
    })

    // 插件 A 信任 command
    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("pluginA")']
      },
      { source: 'plugin', pluginId: 'plugin-a', runCommandAllowed: true }
    )

    // 插件 B 使用同样的 command，应该再次触发 consent（不同 pluginId）
    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("pluginB")']
      },
      { source: 'plugin', pluginId: 'plugin-b', runCommandAllowed: true }
    )

    assert.equal(consentCount, 2)
  })

  it('does not reuse shell:false trust for shell:true execution', async () => {
    let consentCount = 0
    const { service } = createInMemoryRunner({
      settings: {
        requireConsent: true,
        allowShell: true
      },
      consent: async () => {
        consentCount += 1
        return 'trust'
      }
    })

    // 以 shell:false 信任命令
    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("non-shell")']
      },
      { source: 'app' }
    )

    // 以 shell:true 执行同一命令，应该再次触发 consent（shell 风险面更大）
    await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("shell-mode")'],
        shell: true
      },
      { source: 'app' }
    )

    assert.equal(consentCount, 2)
  })

  it('does not match different executables with shared prefix', async () => {
    let consentCount = 0
    let settings = createBaseSettings()
    settings.requireConsent = true
    // 手动注入一个 prefix 为 "git" 的信任记录
    settings.trustedFingerprints = [{
      prefix: 'git',
      source: 'app',
      command: 'git',
      args: ['status'],
      shell: false,
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    }]

    const service = new CommandRunnerService({
      getPolicy: () => settings,
      updatePolicy: (next) => { settings = next; return settings },
      requestConsent: async () => { consentCount += 1; return 'trust' },
      now: () => Date.now(),
      randomId: () => Math.random().toString(36).slice(2, 8)
    })

    // "git-lfs" 不应被 "git" 的信任记录覆盖
    await assert.rejects(
      service.runCommand(
        { command: 'git-lfs', args: ['install'] },
        { source: 'app' }
      ),
      // git-lfs 不存在会抛出执行错误，但重点是 consent 被触发了
      (err: unknown) => {
        // consent 应该被调用（未被信任记录跳过）
        assert.equal(consentCount, 1)
        return true
      }
    )
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

  it('aborts running command when abortSignal is triggered', async () => {
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        defaultTimeoutMs: 60_000,
        maxTimeoutMs: 60_000
      }
    })
    const controller = new AbortController()
    const runPromise = service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      },
      {
        source: 'app',
        abortSignal: controller.signal
      }
    )

    setTimeout(() => controller.abort(), 120)

    await assert.rejects(runPromise, /中止|abort/i)
    assert.equal(getSettings().audit.records.length, 1)
    assert.equal(getSettings().audit.records[0].status, 'error')
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
          args: ['-e', 'process.stdout.write(process.env.SECRET_TOKEN || "")'],
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
