import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ONBOARDING_SUPER_PANEL_TRIGGER_OPTIONS,
  ONBOARDING_USAGE_STEPS,
  createDefaultOnboardingSuperPanel
} from '../../../renderer/components/onboarding-content'

describe('ONBOARDING_USAGE_STEPS', () => {
  it('describes the first actions a new user should try', () => {
    assert.deepEqual(
      ONBOARDING_USAGE_STEPS.map(step => step.name),
      ['唤起 Mulby', '搜索并运行', '打开超级面板', '继续探索']
    )
    assert.equal(ONBOARDING_USAGE_STEPS.length, 4)
    assert.ok(ONBOARDING_USAGE_STEPS.every(step => step.desc.length > 0))
  })
})

describe('createDefaultOnboardingSuperPanel', () => {
  it('keeps super panel disabled while selecting the recommended keyboard trigger', () => {
    const superPanel = createDefaultOnboardingSuperPanel()

    assert.equal(superPanel.enabled, false)
    assert.equal(superPanel.trigger.type, 'keyboard')
    assert.equal(superPanel.trigger.accelerator, 'Alt+Q')
  })

  it('offers all trigger modes available in settings', () => {
    assert.deepEqual(
      ONBOARDING_SUPER_PANEL_TRIGGER_OPTIONS.map(option => option.value),
      ['keyboard', 'mouse_click', 'mouse_longpress', 'double_tap']
    )
  })
})
