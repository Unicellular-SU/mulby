import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { claimPrimaryInstanceLock } from '../../single-instance'

describe('single instance startup', () => {
  it('stops primary startup when another instance already holds the lock', () => {
    let quitCalls = 0
    let markQuittingCalls = 0
    const listeners: string[] = []

    const shouldStart = claimPrimaryInstanceLock({
      requestSingleInstanceLock: () => false,
      quit: () => {
        quitCalls += 1
      },
      onSecondInstance: () => {
        const eventName = 'second-instance'
        listeners.push(eventName)
      }
    }, () => {}, () => {
      markQuittingCalls += 1
    })

    assert.equal(shouldStart, false)
    assert.equal(markQuittingCalls, 1)
    assert.equal(quitCalls, 1)
    assert.deepEqual(listeners, [])
  })

  it('registers the second-instance handler only for the primary instance', () => {
    let quitCalls = 0
    let markQuittingCalls = 0
    const listeners: string[] = []

    const shouldStart = claimPrimaryInstanceLock({
      requestSingleInstanceLock: () => true,
      quit: () => {
        quitCalls += 1
      },
      onSecondInstance: () => {
        const eventName = 'second-instance'
        listeners.push(eventName)
      }
    }, () => {}, () => {
      markQuittingCalls += 1
    })

    assert.equal(shouldStart, true)
    assert.equal(markQuittingCalls, 0)
    assert.equal(quitCalls, 0)
    assert.deepEqual(listeners, ['second-instance'])
  })
})
