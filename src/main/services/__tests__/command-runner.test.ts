import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import path from 'node:path'
import type { CommandRunnerSettings } from '../../../shared/types/settings'
import {
  CommandRunnerService,
  type CommandConsentDecision,
  type CommandConsentRequest
} from '../command-runner-core'
import type { CommandSandboxPreparer } from '../command-sandbox-backend'

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

function createInMemoryRunner(input?: {
  settings?: Partial<CommandRunnerSettings>
  consent?: (request: CommandConsentRequest) => Promise<CommandConsentDecision>
  prepareSandbox?: CommandSandboxPreparer
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
    prepareSandbox: input?.prepareSandbox,
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

  it('allowList hit skips consent when consent is required', async () => {
    let consentCount = 0
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        requireConsent: true,
        allowList: [
          { id: 'allow-node', mode: 'exact', value: process.execPath, enabled: true }
        ]
      },
      consent: async () => {
        consentCount += 1
        return 'deny'
      }
    })

    const result = await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("allowlist-hit")']
      },
      { source: 'app' }
    )

    assert.equal(result.stdout, 'allowlist-hit')
    assert.equal(consentCount, 0)
    assert.equal(getSettings().audit.records[0].status, 'allowed')
  })

  it('allowList miss asks for consent instead of hard-blocking', async () => {
    let consentCount = 0
    let consentDetail = ''
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        requireConsent: true,
        allowList: [
          { id: 'allow-other', mode: 'exact', value: 'definitely-not-node', enabled: true }
        ]
      },
      consent: async (request) => {
        consentCount += 1
        consentDetail = request.detail
        return 'allow-once'
      }
    })

    const result = await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("allowlist-miss")']
      },
      { source: 'app' }
    )

    assert.equal(result.stdout, 'allowlist-miss')
    assert.equal(consentCount, 1)
    assert.match(consentDetail, /白名单: 未命中白名单/)
    assert.equal(getSettings().audit.records[0].status, 'allowed')
  })

  it('allowList miss is blocked when the user denies consent', async () => {
    let consentCount = 0
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        requireConsent: true,
        allowList: [
          { id: 'allow-other', mode: 'exact', value: 'definitely-not-node', enabled: true }
        ]
      },
      consent: async () => {
        consentCount += 1
        return 'deny'
      }
    })

    await assert.rejects(
      service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write("denied")']
        },
        { source: 'app' }
      ),
      /用户拒绝执行命令/
    )

    assert.equal(consentCount, 1)
    assert.equal(getSettings().audit.records[0].status, 'blocked')
  })

  it('denyList stays a hard block before allowList miss consent', async () => {
    let consentCount = 0
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        requireConsent: true,
        allowList: [
          { id: 'allow-other', mode: 'exact', value: 'definitely-not-node', enabled: true }
        ],
        denyList: [
          { id: 'deny-node', mode: 'exact', value: process.execPath, enabled: true }
        ]
      },
      consent: async () => {
        consentCount += 1
        return 'allow-once'
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

    assert.equal(consentCount, 0)
    assert.equal(getSettings().audit.records[0].status, 'blocked')
  })

  it('does not widen shell wrapper command-line trust to the wrapper executable', async () => {
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

    await assert.rejects(
      service.runCommand(
        {
          command: 'cmd /c echo second'
        },
        { source: 'app' }
      )
    )

    assert.match(firstDetail, /信任范围: cmd \/c dir c:\\users\\73221\\\.agents\\skills\\/i)
    assert.equal(consentCount, 2)
    assert.equal(getSettings().trustedFingerprints.length, 2)
    assert.equal(getSettings().trustedFingerprints.some((item) => item.prefix === 'cmd'), false)
    assert.deepEqual(
      getSettings().trustedFingerprints.map((item) => item.matchMode),
      ['commandLineExact', 'commandLineExact']
    )
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
  it('plugin without envKeys inherits non-denied env vars', async () => {
    const { service } = createInMemoryRunner()
    process.env.__MULBY_TEST_SECRET = 'super-secret-value'
    try {
      const result = await service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.env.__MULBY_TEST_SECRET || "missing")']
        },
        { source: 'plugin', pluginId: 'p1', runCommandAllowed: true }
      )
      assert.equal(result.stdout, 'super-secret-value', '插件应继承非 denyEnvKeys 的变量')
    } finally {
      delete process.env.__MULBY_TEST_SECRET
    }
  })

  it('plugin env excludes denyEnvKeys', async () => {
    const { service } = createInMemoryRunner({
      settings: { denyEnvKeys: ['__MULBY_DENIED_KEY'] }
    })
    process.env.__MULBY_DENIED_KEY = 'should-be-hidden'
    try {
      const result = await service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.env.__MULBY_DENIED_KEY || "missing")']
        },
        { source: 'plugin', pluginId: 'p1', runCommandAllowed: true }
      )
      assert.equal(result.stdout, 'missing', 'denyEnvKeys 中的变量不应被继承')
    } finally {
      delete process.env.__MULBY_DENIED_KEY
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

  // ========== H2: allowList 在 shell:true 下深度评估 ==========
  it('shell:true allowList miss on inner command asks for consent even if wrapper matches', async () => {
    let consentCount = 0
    let consentDetail = ''
    const { service } = createInMemoryRunner({
      settings: {
        allowShell: true,
        requireConsent: true,
        allowList: [
          { id: 'r1', enabled: true, mode: 'prefix', value: 'sh' }
        ]
      },
      consent: async (request) => {
        consentCount += 1
        consentDetail = request.detail
        return 'deny'
      }
    })
    // sh 在白名单；但内部命令 node 不在 → 不硬拦截，改为请求 consent
    await assert.rejects(
      service.runCommand(
        {
          command: 'sh',
          args: ['-c', `${process.execPath} -e "process.stdout.write('inner-miss')"`],
          shell: true
        },
        { source: 'app' }
      ),
      /用户拒绝执行命令/,
      'shell:true 下 allowList 未命中内层命令时应进入 consent 流程'
    )
    assert.equal(consentCount, 1)
    assert.match(consentDetail, /白名单: 未命中白名单/)
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

  it('shell:false wrapper command line still checks denyList against the inner command', async () => {
    const { service } = createInMemoryRunner({
      settings: {
        denyList: [
          { id: 'd1', enabled: true, mode: 'prefix', value: 'rm' }
        ]
      }
    })
    await assert.rejects(
      service.runCommand(
        {
          command: 'sh -c "rm -rf /tmp/foo"'
        },
        { source: 'app', assumeUserApproved: true }
      ),
      /命中黑名单/,
      'shell:false 的 shell wrapper 也应按 shell-like 命令深度检查 denyList'
    )
  })

  it('shell:false wrapper command line checks denyList through combined shell flags', async () => {
    const { service } = createInMemoryRunner({
      settings: {
        denyList: [
          { id: 'd1', enabled: true, mode: 'prefix', value: 'rm' }
        ]
      }
    })
    await assert.rejects(
      service.runCommand(
        {
          command: 'bash -lc "rm -rf /tmp/foo"'
        },
        { source: 'app', assumeUserApproved: true }
      ),
      /命中黑名单/,
      'bash -lc 等组合 flag 也应解析内层命令'
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

  it('sandbox profile inherits env filtered by denyEnvKeys and records caller/profile audit fields', async () => {
    const { service, getSettings } = createInMemoryRunner({
      settings: { denyEnvKeys: ['__MULBY_SANDBOX_DENIED'] }
    })
    process.env.__MULBY_SANDBOX_VISIBLE = 'visible-value'
    process.env.__MULBY_SANDBOX_DENIED = 'hidden-value'
    try {
      const resultVisible = await service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.env.__MULBY_SANDBOX_VISIBLE || "missing")']
        },
        {
          source: 'app',
          defaultProfile: 'sandbox',
          maxProfile: 'workspace',
          caller: { kind: 'ai', host: 'app', actor: 'ai', requestId: 'req-1' }
        }
      )
      assert.equal(resultVisible.stdout, 'visible-value')

      const resultDenied = await service.runCommand(
        {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.env.__MULBY_SANDBOX_DENIED || "missing")']
        },
        {
          source: 'app',
          defaultProfile: 'sandbox',
          maxProfile: 'workspace',
          caller: { kind: 'ai', host: 'app', actor: 'ai', requestId: 'req-2' }
        }
      )
      assert.equal(resultDenied.stdout, 'missing')
      assert.equal(getSettings().audit.records[0].executionProfile, 'sandbox')
      assert.equal(getSettings().audit.records[0].sandboxLevel, 'policy')
      assert.equal(getSettings().audit.records[0].caller?.kind, 'ai')
      assert.equal(getSettings().audit.records[0].caller?.requestId, 'req-1')
    } finally {
      delete process.env.__MULBY_SANDBOX_VISIBLE
      delete process.env.__MULBY_SANDBOX_DENIED
    }
  })

  it('sandbox profile blocks shell=true commands before execution', async () => {
    const { service, getSettings } = createInMemoryRunner({
      settings: {
        allowShell: true
      }
    })

    await assert.rejects(
      service.runCommand(
        {
          command: 'sh',
          args: ['-c', 'echo blocked'],
          shell: true
        },
        {
          source: 'app',
          defaultProfile: 'sandbox',
          maxProfile: 'workspace',
          caller: { kind: 'ai', host: 'app', actor: 'ai' }
        }
      ),
      /sandbox 执行环境默认禁止 shell=true/
    )
    assert.equal(getSettings().audit.records[0].status, 'blocked')
    assert.equal(getSettings().audit.records[0].executionProfile, 'sandbox')
  })

  it('sandbox profile does not let input writableRoots expand configured roots', async () => {
    const { service, getSettings } = createInMemoryRunner()
    const outsideRoot = `${process.cwd()}/..`

    await assert.rejects(
      service.runCommand(
        {
          command: process.execPath,
          args: ['--version'],
          cwd: outsideRoot,
          writableRoots: [outsideRoot]
        },
        {
          source: 'app',
          defaultProfile: 'sandbox',
          maxProfile: 'workspace',
          caller: { kind: 'ai', host: 'app', actor: 'ai' }
        }
      ),
      /sandbox 执行环境禁止使用白名单外 cwd/
    )
    assert.equal(getSettings().audit.records[0].status, 'blocked')
    assert.equal(getSettings().audit.records[0].executionProfile, 'sandbox')
  })

  it('workspace profile can use plugin readwrite directory grants as command roots', async () => {
    const { service, getSettings } = createInMemoryRunner()
    const outsideRoot = `${process.cwd()}/..`

    const result = await service.runCommand(
      {
        command: process.execPath,
        args: ['--version'],
        cwd: outsideRoot
      },
      {
        source: 'plugin',
        pluginId: 'demo.plugin',
        runCommandAllowed: true,
        defaultProfile: 'workspace',
        maxProfile: 'workspace',
        directoryAccessRoots: {
          read: [],
          readwrite: [outsideRoot]
        }
      }
    )

    assert.equal(result.success, true)
    assert.ok(getSettings().audit.records[0].rootScope?.includes(path.resolve(outsideRoot)))
  })

  it('workspace profile does not use read-only plugin grants for command roots', async () => {
    const { service, getSettings } = createInMemoryRunner()
    const outsideRoot = `${process.cwd()}/..`

    await assert.rejects(
      service.runCommand(
        {
          command: process.execPath,
          args: ['--version'],
          cwd: outsideRoot
        },
        {
          source: 'plugin',
          pluginId: 'demo.plugin',
          runCommandAllowed: true,
          defaultProfile: 'workspace',
          maxProfile: 'workspace',
          directoryAccessRoots: {
            read: [outsideRoot],
            readwrite: []
          }
        }
      ),
      /workspace 执行环境禁止使用白名单外 cwd/
    )

    assert.equal(getSettings().audit.records[0].status, 'blocked')
  })

  it('sandbox profile rejects explicit network requests when sandbox network is disabled', async () => {
    const { service, getSettings } = createInMemoryRunner()

    await assert.rejects(
      service.runCommand(
        {
          command: process.execPath,
          args: ['--version'],
          network: true
        },
        {
          source: 'app',
          defaultProfile: 'sandbox',
          maxProfile: 'workspace',
          caller: { kind: 'ai', host: 'app', actor: 'ai' }
        }
      ),
      /sandbox 执行环境默认禁止网络访问/
    )
    assert.equal(getSettings().audit.records[0].status, 'blocked')
    assert.equal(getSettings().audit.records[0].networkAllowed, false)
  })

  it('records OS sandbox backend fields from the prepared spawn plan', async () => {
    const { service, getSettings } = createInMemoryRunner({
      prepareSandbox: (plan) => ({
        command: plan.command,
        args: plan.args,
        cwd: plan.cwd,
        env: plan.env,
        shell: plan.shell,
        sandboxLevel: 'os',
        sandboxBackend: 'linux-namespace'
      })
    })

    const result = await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("os-sandbox")']
      },
      {
        source: 'app',
        defaultProfile: 'sandbox',
        maxProfile: 'workspace',
        caller: { kind: 'ai', host: 'app', actor: 'ai' }
      }
    )

    assert.equal(result.stdout, 'os-sandbox')
    assert.equal(getSettings().audit.records[0].sandboxLevel, 'os')
    assert.equal(getSettings().audit.records[0].sandboxBackend, 'linux-namespace')
  })

  it('records policy fallback when OS sandbox preparation falls back', async () => {
    const { service, getSettings } = createInMemoryRunner({
      prepareSandbox: (plan) => ({
        command: plan.command,
        args: plan.args,
        cwd: plan.cwd,
        env: plan.env,
        shell: plan.shell,
        sandboxLevel: 'policy',
        sandboxBackend: 'policy',
        sandboxFallbackReason: 'unshare not found'
      })
    })

    const result = await service.runCommand(
      {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("fallback")']
      },
      {
        source: 'app',
        defaultProfile: 'sandbox',
        maxProfile: 'workspace',
        caller: { kind: 'ai', host: 'app', actor: 'ai' }
      }
    )

    assert.equal(result.stdout, 'fallback')
    assert.equal(getSettings().audit.records[0].sandboxLevel, 'policy')
    assert.equal(getSettings().audit.records[0].sandboxBackend, 'policy')
    assert.equal(getSettings().audit.records[0].sandboxFallbackReason, 'unshare not found')
  })

  it('blocks command when strict OS sandbox preparation fails', async () => {
    const { service, getSettings } = createInMemoryRunner({
      prepareSandbox: () => {
        const error = new Error('OS sandbox backend unavailable: test backend missing') as Error & { kind?: string }
        error.kind = 'blocked'
        throw error
      }
    })

    await assert.rejects(
      service.runCommand(
        {
          command: process.execPath,
          args: ['--version']
        },
        {
          source: 'app',
          defaultProfile: 'sandbox',
          maxProfile: 'workspace',
          caller: { kind: 'ai', host: 'app', actor: 'ai' }
        }
      ),
      /OS sandbox backend unavailable/
    )
    assert.equal(getSettings().audit.records[0].status, 'blocked')
    assert.match(getSettings().audit.records[0].reason || '', /test backend missing/)
  })

  it('blocks execution profile requests above caller maximum', async () => {
    const { service, getSettings } = createInMemoryRunner()

    await assert.rejects(
      service.runCommand(
        {
          command: process.execPath,
          args: ['--version'],
          executionProfile: 'trusted'
        },
        {
          source: 'app',
          defaultProfile: 'sandbox',
          maxProfile: 'workspace',
          caller: { kind: 'ai', host: 'app', actor: 'ai' }
        }
      ),
      /最多允许 workspace 执行环境/
    )
    assert.equal(getSettings().audit.records[0].status, 'blocked')
    assert.equal(getSettings().audit.records[0].caller?.actor, 'ai')
  })
})
