import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SearchRanking } from '../../plugin/search/ranking'
import { findBestMatch } from '../../../shared/search-matcher'
import type { AppSearchResult } from '../../plugin/search/types'
import type { InputPayload, PluginFeature } from '../../../shared/types/plugin'

function createTextPayload(text: string): InputPayload {
  return {
    text,
    attachments: []
  }
}

function createKeywordFeature(keyword: string): PluginFeature {
  return {
    code: 'test.keyword',
    explain: 'test keyword matching',
    cmds: [{ type: 'keyword', value: keyword }]
  }
}

function createApp(name: string): AppSearchResult {
  return {
    name,
    path: `/Applications/${name}.app`,
    kind: 'application'
  }
}

describe('search ranking capability', () => {
  it('supports pinyin full, pinyin initials, cross-character and english initials', () => {
    const ranking = new SearchRanking()

    assert.ok(ranking.scoreText('微信', 'weixin') > 0, 'weixin should match 微信')
    assert.ok(ranking.scoreText('微信', 'wx') > 0, 'wx should match 微信')
    assert.ok(ranking.scoreText('百度网盘', 'bdwp') > 0, 'bdwp should match 百度网盘')
    assert.ok(ranking.scoreText('百度网盘', '百网') > 0, '百网 should match 百度网盘')
    assert.ok(ranking.scoreText('System Settings', 'ss') > 0, 'ss should match System Settings')
  })

  it('ranks expected app as top result for wx/bdwp/百网/ss', () => {
    const ranking = new SearchRanking()

    const candidates = [
      createApp('微信'),
      createApp('百度网盘'),
      createApp('System Settings'),
      createApp('Calculator')
    ]

    const topName = (query: string) => {
      const sorted = candidates
        .map((item) => ({ item, score: ranking.scoreApp(item, query) }))
        .sort((a, b) => b.score - a.score)
      return sorted[0]?.item.name
    }

    assert.equal(topName('wx'), '微信')
    assert.equal(topName('bdwp'), '百度网盘')
    assert.equal(topName('百网'), '百度网盘')
    assert.equal(topName('ss'), 'System Settings')
  })
})

describe('plugin keyword matcher capability', () => {
  it('matches keyword command with enhanced patterns', () => {
    const cases: Array<{ keyword: string; query: string }> = [
      { keyword: '微信', query: 'weixin' },
      { keyword: '微信', query: 'wx' },
      { keyword: '百度网盘', query: 'bdwp' },
      { keyword: '百度网盘', query: '百网' },
      { keyword: 'System Settings', query: 'ss' }
    ]

    for (const testCase of cases) {
      const feature = createKeywordFeature(testCase.keyword)
      const payload = createTextPayload(testCase.query)
      const match = findBestMatch(feature, payload)
      assert.ok(match, `${testCase.query} should match keyword ${testCase.keyword}`)
      assert.equal(match?.matchType, 'keyword')
    }
  })
})
