import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CommandRunnerSettings } from '../../../shared/types/settings'
import {
  CommandRunnerService,
  type CommandConsentDecision,
  type CommandConsentRequest
} from '../command-runner-core'

function createBaseSettings(): CommandRunnerSettings {
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
    audit: {
      maxItems: 500,
      records: []
    }
  }
}

function createInMemoryRunner(input?: {
  settings?: Partial<CommandRunnerSettings>
  consent?: (request: CommandConsentRequest) => Promise<CommandConsentDecision>
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

  it('derives trust prefix from the executable when command contains a full command line', async () => {
    let consentCount = 0
    let firstDetail = ''
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        requireConsent: true
      },
      consent: async (request) => {
        consentCount += 1
        if (consentCount === 1) firstDetail = request.detail
        return 'trust'
      }
    })

    await assert.rejects(
      service.runCommand(
        {
          command: 'cmd /c dir C:\\Users\\73221\\.agents\\skills\\'
        },
        { source: 'app' }
      )
    )

    await assert.rejects(
      service.runCommand(
        {
          command: 'cmd /c echo second'
        },
        { source: 'app' }
      )
    )

    assert.match(firstDetail, /信任前缀: cmd（信任后，以此开头的命令将自动允许）/)
    assert.equal(consentCount, 1)
    assert.equal(getSettings().trustedFingerprints.length, 1)
    assert.equal(getSettings().trustedFingerprints[0].prefix, 'cmd')
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
      // 返回 deny，确保命令被策略层拒绝（跨平台一致的 reject 行为）
      requestConsent: async () => { consentCount += 1; return 'deny' },
      now: () => Date.now(),
      randomId: () => Math.random().toString(36).slice(2, 8)
    })

    // "git-nonexistent-xyz" 不应被 "git" 的信任记录覆盖，应触发 consent 并被拒绝
    await assert.rejects(
      service.runCommand(
        { command: 'git-nonexistent-xyz', args: ['install'] },
        { source: 'app' }
      ),
      /拒绝/
    )
    // consent 应该被调用（未被信任记录跳过）
    assert.equal(consentCount, 1)
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

  // ========== H1: 插件 envKeys 接通 ==========
  it('plugin without envKeys gets minimal safe env baseline only', async () => {
    const { service } = createInMemoryRunner()
    // 主进程设置一个非基线的变量
    process.env.__MULBY_TEST_SECRET = 'super-secret-value'
    try {
      const result = await service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.env.__MULBY_TEST_SECRET || "missing")']
        },
        { source: 'plugin', pluginId: 'p1', runCommandAllowed: true }
      )
      assert.equal(result.stdout, 'missing', '插件未声明 envKeys 时不应继承非基线变量')
    } finally {
      delete process.env.__MULBY_TEST_SECRET
    }
  })

  it('plugin with envKeys array inherits declared variables', async () => {
    const { service } = createInMemoryRunner()
    process.env.__MULBY_TEST_ALLOWED = 'inherited-ok'
    try {
      const result = await service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.env.__MULBY_TEST_ALLOWED || "missing")']
        },
        {
          source: 'plugin',
          pluginId: 'p1',
          runCommandAllowed: true,
          envKeys: ['__MULBY_TEST_ALLOWED']
        }
      )
      assert.equal(result.stdout, 'inherited-ok', 'manifest envKeys 应让指定变量被继承')
    } finally {
      delete process.env.__MULBY_TEST_ALLOWED
    }
  })

  it('plugin with envKeys="*" inherits full process env', async () => {
    const { service } = createInMemoryRunner()
    process.env.__MULBY_TEST_WILDCARD = 'wildcard-ok'
    try {
      const result = await service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.env.__MULBY_TEST_WILDCARD || "missing")']
        },
        {
          source: 'plugin',
          pluginId: 'p1',
          runCommandAllowed: true,
          envKeys: '*'
        }
      )
      assert.equal(result.stdout, 'wildcard-ok', 'envKeys="*" 应视为完整继承')
    } finally {
      delete process.env.__MULBY_TEST_WILDCARD
    }
  })

  // ========== H2: allowList 在 shell:true 下深度校验 ==========
  it('shell:true allowList blocks inner command even if wrapper matches', async () => {
    const { service } = createInMemoryRunner({
      settings: {
        allowShell: true,
        allowList: [
          { id: 'r1', enabled: true, mode: 'prefix', value: 'sh' }
        ]
      }
    })
    // sh 在白名单；但内部命令 curl 不在 → 应被拒
    await assert.rejects(
      service.runCommand(
        {
          command: 'sh',
          args: ['-c', 'curl http://example.com'],
          shell: true
        },
        { source: 'app', assumeUserApproved: true }
      ),
      /命令不在白名单中/,
      'shell:true 下 allowList 应对内层命令做深度校验'
    )
  })

  it('shell:true allowList passes when all inner tokens are whitelisted', async () => {
    const { service } = createInMemoryRunner({
      settings: {
        allowShell: true,
        allowList: [
          { id: 'r1', enabled: true, mode: 'prefix', value: 'sh' },
          { id: 'r2', enabled: true, mode: 'prefix', value: 'node' }
        ]
      }
    })
    // 内层就是 node 自身，且基线 allowList 含 node
    const result = await service.runCommand(
      {
        command: 'sh',
        args: ['-c', `node -e "process.stdout.write('inner-ok')"`],
        shell: true
      },
      { source: 'app', assumeUserApproved: true }
    )
    assert.equal(result.success, true)
  })

  // ========== H3: $()/backtick token 提取 + 混淆模式拦截 ==========
  it('shell:true denyList catches command inside $() substitution', async () => {
    const { service } = createInMemoryRunner({
      settings: {
        allowShell: true,
        denyList: [
          { id: 'd1', enabled: true, mode: 'prefix', value: 'rm' }
        ]
      }
    })
    await assert.rejects(
      service.runCommand(
        {
          command: 'sh',
          args: ['-c', 'echo $(rm -rf /tmp/foo)'],
          shell: true
        },
        { source: 'app', assumeUserApproved: true }
      ),
      /命中黑名单/,
      '$(...) 内部的 rm 应被 denyList 拦截'
    )
  })

  it('shell:true denyList catches command inside backtick substitution', async () => {
    const { service } = createInMemoryRunner({
      settings: {
        allowShell: true,
        denyList: [
          { id: 'd1', enabled: true, mode: 'prefix', value: 'curl' }
        ]
      }
    })
    await assert.rejects(
      service.runCommand(
        {
          command: 'sh',
          args: ['-c', 'echo `curl evil.com`'],
          shell: true
        },
        { source: 'app', assumeUserApproved: true }
      ),
      /命中黑名单/,
      '`cmd` 内部的 curl 应被 denyList 拦截'
    )
  })

  it('shell:true rejects obfuscated patterns (-EncodedCommand / eval base64)', async () => {
    const { service } = createInMemoryRunner({
      settings: {
        allowShell: true,
        allowList: [{ id: 'r1', enabled: true, mode: 'prefix', value: 'powershell' }]
      }
    })
    await assert.rejects(
      service.runCommand(
        {
          command: 'powershell',
          args: ['-EncodedCommand', 'SQBFAFgA'],
          shell: true
        },
        { source: 'app', assumeUserApproved: true }
      ),
      /混淆\/编码特征/,
      'PowerShell -EncodedCommand 应被混淆拦截器拦截'
    )
  })

  // ========== H5: spawn env fallback 移除 ==========
  // 此场景覆盖「app source 没有显式 env 时也能正常跑」
  it('app source without input env still runs (safeEnv inherits process.env)', async () => {
    const { service } = createInMemoryRunner()
    const result = await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write(String(typeof process.env.PATH === "string"))']
      },
      { source: 'app' }
    )
    assert.equal(result.stdout, 'true')
  })
})
