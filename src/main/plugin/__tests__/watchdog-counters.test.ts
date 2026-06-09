import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

// watchdog.ts 顶层 `import log from 'electron-log'`，在纯 Node 测试环境需先桩掉，
// 复用仓库既有的 require.cache mock 模式（见 input.test.ts）。
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

type WatchdogModule = typeof import('../watchdog')
let modulePromise: Promise<WatchdogModule> | null = null
async function loadWatchdog(): Promise<WatchdogModule> {
  modulePromise ??= import('../watchdog')
  return modulePromise
}

describe('PluginHostWatchdog request/error counters', () => {
  it('accumulates non-decaying totals while still feeding the windowed counters', async () => {
    const { PluginHostWatchdog } = await loadWatchdog()
    const wd = new PluginHostWatchdog()
    wd.registerHost('plugin-a')

    wd.recordRequest('plugin-a')
    wd.recordRequest('plugin-a')
    wd.recordRequest('plugin-a')
    wd.recordError('plugin-a')

    const health = wd.getHostHealth('plugin-a')
    assert.ok(health)
    // 累计计数（UI 展示用）
    assert.equal(health.totalRequestCount, 3)
    assert.equal(health.totalErrorCount, 1)
    // 滑动计数（限流/错误阈值用）此刻与累计一致（尚未衰减）
    assert.equal(health.requestCount, 3)
    assert.equal(health.errorCount, 1)
  })

  it('treats counting for an unregistered host as a safe no-op', async () => {
    const { PluginHostWatchdog } = await loadWatchdog()
    const wd = new PluginHostWatchdog()

    assert.equal(wd.recordRequest('ghost'), true)
    assert.doesNotThrow(() => wd.recordError('ghost'))
    assert.equal(wd.getHostHealth('ghost'), undefined)
  })

  it('keeps existing counts when the same host is re-registered (idempotent)', async () => {
    const { PluginHostWatchdog } = await loadWatchdog()
    const wd = new PluginHostWatchdog()
    wd.registerHost('plugin-a', { maxMemoryMB: 256 })
    wd.recordRequest('plugin-a')
    wd.recordError('plugin-a')

    // 模拟 BackgroundManager.start 在 HostManager.createHost 之后的二次注册：
    // 不应重置已有计数，也不应丢失既有 customLimits。
    wd.registerHost('plugin-a')

    const health = wd.getHostHealth('plugin-a')
    assert.ok(health)
    assert.equal(health.totalRequestCount, 1)
    assert.equal(health.totalErrorCount, 1)
    assert.equal(health.customLimits?.maxMemoryMB, 256)
  })

  it('updates custom limits on re-register without resetting counters', async () => {
    const { PluginHostWatchdog } = await loadWatchdog()
    const wd = new PluginHostWatchdog()
    wd.registerHost('plugin-a', { maxMemoryMB: 256 })
    wd.recordRequest('plugin-a')

    wd.registerHost('plugin-a', { maxMemoryMB: 128 })

    const health = wd.getHostHealth('plugin-a')
    assert.ok(health)
    assert.equal(health.totalRequestCount, 1)
    assert.equal(health.customLimits?.maxMemoryMB, 128)
  })

  it('resets totals only after an explicit unregister + register cycle', async () => {
    const { PluginHostWatchdog } = await loadWatchdog()
    const wd = new PluginHostWatchdog()
    wd.registerHost('plugin-a')
    wd.recordRequest('plugin-a')
    wd.recordError('plugin-a')

    wd.unregisterHost('plugin-a')
    wd.registerHost('plugin-a')

    const health = wd.getHostHealth('plugin-a')
    assert.ok(health)
    assert.equal(health.totalRequestCount, 0)
    assert.equal(health.totalErrorCount, 0)
  })
})
