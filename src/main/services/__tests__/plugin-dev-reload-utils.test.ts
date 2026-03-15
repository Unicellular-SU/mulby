import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { Plugin } from '../../../shared/types/plugin'
import {
  buildFeatureIconCacheKey,
  collectDevPluginWatchTargets,
  collectPluginMetadataWatchFiles
} from '../../plugin/dev-reload-utils'

function createPlugin(rootDir: string, overrides: Partial<Plugin['manifest']> = {}): Plugin {
  return {
    id: 'plugin.dev',
    enabled: true,
    path: rootDir,
    manifest: {
      name: 'plugin.dev',
      version: '1.0.0',
      displayName: 'Plugin Dev',
      description: 'test plugin',
      main: 'dist/main.js',
      features: [
        {
          code: 'feature.main',
          explain: 'Main feature',
          cmds: [],
          icon: 'assets/feature.png'
        }
      ],
      ...overrides
    }
  }
}

function normalizeRelative(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).replace(/\\/g, '/')
}

describe('plugin dev reload utils', () => {
  it('collects code and metadata watch targets for dev plugins', () => {
    const rootDir = path.join(os.tmpdir(), 'mulby-dev-plugin')
    const plugin = createPlugin(rootDir)

    const watchTargets = collectDevPluginWatchTargets(plugin)
      .map((target) => `${target.kind}:${normalizeRelative(rootDir, target.filePath)}`)
      .sort()

    assert.deepEqual(watchTargets, [
      'code:dist/main.js',
      'metadata:assets/feature.png',
      'metadata:icon.png',
      'metadata:manifest.json'
    ])
  })

  it('ignores remote, inline svg, and emoji icons when collecting metadata files', () => {
    const rootDir = path.join(os.tmpdir(), 'mulby-dev-plugin-icons')
    const plugin = createPlugin(rootDir, {
      icon: 'https://example.com/icon.png',
      features: [
        {
          code: 'feature.svg',
          explain: 'SVG feature',
          cmds: [],
          icon: '<svg viewBox="0 0 1 1"></svg>'
        },
        {
          code: 'feature.emoji',
          explain: 'Emoji feature',
          cmds: [],
          icon: { type: 'emoji', value: 'rocket' }
        },
        {
          code: 'feature.local',
          explain: 'Local feature',
          cmds: [],
          icon: { type: 'file', value: 'assets/local.png' }
        }
      ]
    })

    const metadataFiles = collectPluginMetadataWatchFiles(plugin)
      .map((filePath) => normalizeRelative(rootDir, filePath))
      .sort()

    assert.deepEqual(metadataFiles, [
      'assets/local.png',
      'manifest.json'
    ])
  })

  it('changes feature icon cache key when local icon content changes', async (t) => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-dev-reload-'))
    t.after(async () => {
      await rm(rootDir, { recursive: true, force: true })
    })

    const iconPath = path.join(rootDir, 'assets', 'feature.png')
    await mkdir(path.dirname(iconPath), { recursive: true })
    await writeFile(iconPath, Buffer.from([0, 1, 2, 3]))

    const plugin = createPlugin(rootDir)
    const feature = plugin.manifest.features[0]
    const firstKey = buildFeatureIconCacheKey(plugin.id, feature, plugin.path)

    await writeFile(iconPath, Buffer.from([0, 1, 2, 3, 4, 5, 6]))
    const secondKey = buildFeatureIconCacheKey(plugin.id, feature, plugin.path)

    assert.notEqual(secondKey, firstKey)
  })
})
