import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getEmptyQuerySearchResults } from '../empty-query-search'
import type { Plugin } from '../../../shared/types/plugin'

function plugin(
  id: string,
  cmds: Plugin['manifest']['features'][number]['cmds']
): Plugin {
  return {
    id,
    path: `/${id}`,
    enabled: true,
    manifest: {
      name: id,
      displayName: id,
      version: '1.0.0',
      description: '',
      author: '',
      type: 'utility',
      features: [
        {
          code: 'main',
          explain: `${id} main`,
          cmds
        }
      ]
    }
  } as Plugin
}

describe('empty-query plugin search', () => {
  it('returns only window-matched features when active window context is available', () => {
    const results = getEmptyQuerySearchResults(
      [
        plugin('window-tool', [{ type: 'window', app: 'Code' }]),
        plugin('keyword-tool', [{ type: 'keyword', value: 'keyword' }])
      ],
      {
        text: '',
        attachments: [],
        activeWindow: {
          app: 'Code',
          title: 'Project',
          bundleId: 'com.microsoft.VSCode'
        }
      },
      (item) => item.manifest.features
    )

    assert.deepEqual(
      results.map((result) => ({
        pluginId: result.plugin.id,
        featureCode: result.feature.code,
        matchType: result.matchType
      })),
      [
        {
          pluginId: 'window-tool',
          featureCode: 'main',
          matchType: 'window'
        }
      ]
    )
  })

  it('returns no default plugin entries when there is no active window match', () => {
    const results = getEmptyQuerySearchResults(
      [
        plugin('window-tool', [{ type: 'window', app: 'Safari' }]),
        plugin('keyword-tool', [{ type: 'keyword', value: 'keyword' }])
      ],
      {
        text: '',
        attachments: [],
        activeWindow: {
          app: 'Code',
          title: 'Project',
          bundleId: 'com.microsoft.VSCode'
        }
      },
      (item) => item.manifest.features
    )

    assert.equal(results.length, 0)
  })
})
