import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { normalizeDeveloperSettings } from '../developer-settings-utils'

describe('normalizeDeveloperSettings', () => {
  it('migrates legacy pluginPaths into pluginProjects as collection/migrated', () => {
    const out = normalizeDeveloperSettings({
      enabled: true,
      pluginPaths: ['/tmp/devdir'],
      autoReload: true,
      showDevTools: false,
      logLevel: 'info'
    } as never)
    assert.equal(out.pluginProjects.length, 1)
    assert.equal(out.pluginProjects[0].type, 'collection')
    assert.equal(out.pluginProjects[0].source, 'migrated')
    assert.equal(out.pluginProjects[0].path, path.resolve('/tmp/devdir'))
    assert.ok(out.pluginPaths.includes('/tmp/devdir')) // legacy 保留
  })

  it('does not double-migrate when pluginProjects already present', () => {
    const out = normalizeDeveloperSettings({
      enabled: true,
      pluginPaths: ['/tmp/devdir'],
      pluginProjects: [
        { id: 'x', path: '/tmp/other', type: 'single', source: 'added', createdAt: 1 }
      ],
      autoReload: true,
      showDevTools: false,
      logLevel: 'info'
    } as never)
    assert.equal(out.pluginProjects.length, 1)
    assert.equal(out.pluginProjects[0].id, 'x')
    assert.equal(out.pluginProjects[0].type, 'single')
  })

  it('dedupes pluginProjects by resolved path, keeps first', () => {
    const out = normalizeDeveloperSettings({
      enabled: true,
      pluginPaths: [],
      pluginProjects: [
        { id: '1', path: '/tmp/p', type: 'single', source: 'added', createdAt: 1 },
        { id: '2', path: '/tmp/p/', type: 'collection', source: 'imported', createdAt: 2 }
      ],
      autoReload: true,
      showDevTools: false,
      logLevel: 'info'
    } as never)
    assert.equal(out.pluginProjects.length, 1)
    assert.equal(out.pluginProjects[0].id, '1')
  })

  it('filters invalid entries and fills defaults', () => {
    const out = normalizeDeveloperSettings({
      enabled: true,
      pluginPaths: [],
      pluginProjects: [
        { path: '   ' } as never,
        { path: '/tmp/valid' } as never
      ],
      autoReload: true,
      showDevTools: false,
      logLevel: 'info'
    } as never)
    assert.equal(out.pluginProjects.length, 1)
    assert.equal(out.pluginProjects[0].path, path.resolve('/tmp/valid'))
    assert.equal(out.pluginProjects[0].type, 'collection') // 缺省回退
    assert.equal(out.pluginProjects[0].source, 'added')
    assert.ok(out.pluginProjects[0].id)
    assert.ok(out.pluginProjects[0].createdAt > 0)
  })

  it('returns empty pluginProjects when no legacy paths and no projects', () => {
    const out = normalizeDeveloperSettings({
      enabled: false,
      pluginPaths: [],
      autoReload: true,
      showDevTools: false,
      logLevel: 'info'
    } as never)
    assert.equal(out.pluginProjects.length, 0)
    assert.equal(out.enabled, false)
  })

  it('handles undefined input gracefully', () => {
    const out = normalizeDeveloperSettings(undefined)
    assert.ok(Array.isArray(out.pluginProjects))
    assert.ok(Array.isArray(out.pluginPaths))
  })
})
