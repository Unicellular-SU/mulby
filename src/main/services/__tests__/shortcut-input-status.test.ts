import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getShortcutStatusText } from '../../../renderer/components/settings/shortcut-status-text'

describe('shortcut input status text', () => {
  it('does not show a failure when no registration status is provided', () => {
    assert.equal(getShortcutStatusText(undefined), '')
  })

  it('shows registration failure only for an explicit failed status without a specific reason', () => {
    assert.equal(getShortcutStatusText({ ok: false }), '注册失败')
  })

  it('describes hook-backed shortcuts as captured by the low-level hook', () => {
    assert.equal(getShortcutStatusText({ ok: true, via: 'hook' }), '底层接管中')
  })
})
