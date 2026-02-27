import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getCommandDisplayLabel,
  getCommandId,
  getCommandKind,
  getCommandSignature,
  isCommandBindable
} from '../../../shared/search-matcher'
import type { PluginCmd } from '../../../shared/types/plugin'

describe('plugin command classification', () => {
  it('classifies launch and match commands', () => {
    const launch: PluginCmd = { type: 'keyword', value: 'calc' }
    const match: PluginCmd = { type: 'regex', match: '^https?://' }

    assert.equal(getCommandKind(launch), 'launch')
    assert.equal(getCommandKind(match), 'match')
    assert.equal(isCommandBindable(launch), true)
    assert.equal(isCommandBindable(match), false)
  })

  it('builds default labels for match commands when label is absent', () => {
    const feature = '网页工具'

    assert.equal(
      getCommandDisplayLabel({ type: 'regex', match: '^https?://' }, feature),
      '正则匹配 · 网页工具'
    )
    assert.equal(
      getCommandDisplayLabel({ type: 'files', exts: ['pdf'] }, feature),
      '文件匹配 · 网页工具'
    )
    assert.equal(
      getCommandDisplayLabel({ type: 'img' }, feature),
      '图像匹配 · 网页工具'
    )
    assert.equal(
      getCommandDisplayLabel({ type: 'over' }, feature),
      '文本匹配 · 网页工具'
    )
  })

  it('generates stable signatures and command ids', () => {
    const cmd: PluginCmd = { type: 'keyword', value: 'translate' }
    const signature = getCommandSignature(cmd)

    assert.equal(signature, getCommandSignature({ type: 'keyword', value: 'translate' }))
    assert.notEqual(getCommandId(cmd, 1), getCommandId(cmd, 2))
  })
})

