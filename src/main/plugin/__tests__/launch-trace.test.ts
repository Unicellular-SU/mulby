import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

// launch-trace.ts 顶层 `import log from 'electron-log'`，纯 Node 测试需先桩掉。
const require = createRequire(import.meta.url)
const electronLogModulePath = require.resolve('electron-log')

function installModuleMock(modulePath: string, exportsValue: unknown): void {
  ;(require.cache as Record<string, NodeJS.Module | undefined>)[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
    children: [],
    paths: [],
    parent: null,
    path: '',
    require,
    isPreloading: false
  } as unknown as NodeJS.Module
}

installModuleMock(electronLogModulePath, {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {}
})

type LaunchTraceModule = typeof import('../launch-trace')
let modulePromise: Promise<LaunchTraceModule> | null = null
async function loadModule(): Promise<LaunchTraceModule> {
  modulePromise ??= import('../launch-trace')
  return modulePromise
}

describe('launch-trace formatting', () => {
  it('formats a compact single-line summary with total = last mark', async () => {
    const { formatLaunchSummary } = await loadModule()
    const summary = formatLaunchSummary('demo-plugin', [
      { phase: 'onload', at: 40 },
      { phase: 'attached', at: 120 }
    ])
    assert.equal(summary, '[LaunchProfile] plugin=demo-plugin total=120ms | onload:+40ms attached:+120ms')
  })

  it('handles an empty mark list without throwing', async () => {
    const { formatLaunchSummary } = await loadModule()
    const summary = formatLaunchSummary('demo-plugin', [])
    assert.equal(summary, '[LaunchProfile] plugin=demo-plugin total=0ms |')
  })

  it('no-ops marks/flush when profiling is disabled (default)', async () => {
    const mod = await loadModule()
    delete process.env.MULBY_LAUNCH_PROFILE
    mod.startLaunchTrace(123, 'p')
    mod.markLaunchPhase(123, 'onload')
    assert.equal(mod.flushLaunchTrace(123), null)
  })

  it('records and flushes a summary when profiling is enabled', async () => {
    const mod = await loadModule()
    process.env.MULBY_LAUNCH_PROFILE = '1'
    try {
      const launchId = 5_000
      mod.startLaunchTrace(launchId, 'p2')
      mod.markLaunchPhase(launchId, 'onload', launchId + 30)
      mod.markLaunchPhase(launchId, 'attached', launchId + 90)
      const summary = mod.flushLaunchTrace(launchId)
      assert.equal(summary, '[LaunchProfile] plugin=p2 total=90ms | onload:+30ms attached:+90ms')
      // 已 flush，再次 flush 应为 null
      assert.equal(mod.flushLaunchTrace(launchId), null)
    } finally {
      delete process.env.MULBY_LAUNCH_PROFILE
    }
  })
})
