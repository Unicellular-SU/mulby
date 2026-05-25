import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  resolveAiCommandExecutionPermission,
  resolveDirectCommandExecutionPermission
} from '../command-execution-permissions'

describe('plugin command execution permissions', () => {
  it('keeps legacy runCommand scoped to direct plugin commands', () => {
    const direct = resolveDirectCommandExecutionPermission({ runCommand: true })
    const ai = resolveAiCommandExecutionPermission({ runCommand: true })

    assert.equal(direct.allowed, true)
    assert.equal(direct.defaultProfile, 'trusted')
    assert.equal(direct.maxProfile, 'trusted')
    assert.equal(ai.allowed, false)
  })

  it('uses explicit commandExecution.ai for AI-generated commands', () => {
    const ai = resolveAiCommandExecutionPermission({
      commandExecution: {
        ai: {
          enabled: true,
          defaultProfile: 'sandbox',
          maxProfile: 'workspace'
        }
      }
    })

    assert.equal(ai.allowed, true)
    assert.equal(ai.defaultProfile, 'sandbox')
    assert.equal(ai.maxProfile, 'workspace')
  })
})
