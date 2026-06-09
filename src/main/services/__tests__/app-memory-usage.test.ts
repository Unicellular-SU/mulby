import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  estimateAppPrivateMemoryBytes,
  aggregateRendererBytesByPlugin
} from '../app-memory-usage'

describe('estimateAppPrivateMemoryBytes', () => {
  it('subtracts the shared baseline counted in the extra (N-1) processes', () => {
    // 3 进程，各含 200 共享。裸加=800，扣除 200×2=400 → 400。
    assert.equal(estimateAppPrivateMemoryBytes([300, 250, 250], 200), 400)
  })

  it('never drops below the largest single process', () => {
    // 裸加=898，扣除 400 → 498，但最大单进程=500 → 取 500。
    assert.equal(estimateAppPrivateMemoryBytes([500, 199, 199], 200), 500)
  })

  it('returns 0 for no processes', () => {
    assert.equal(estimateAppPrivateMemoryBytes([], 200), 0)
  })

  it('falls back to the plain sum when there is no shared baseline', () => {
    assert.equal(estimateAppPrivateMemoryBytes([300, 250, 250], 0), 800)
  })

  it('handles a single process (no double counting possible)', () => {
    assert.equal(estimateAppPrivateMemoryBytes([420], 200), 420)
  })
})

describe('aggregateRendererBytesByPlugin', () => {
  it('sums deduped pid bytes per plugin', () => {
    const rendererPidsByPlugin = new Map<string, Set<number>>([
      ['a', new Set([1, 2])],
      ['b', new Set([3])]
    ])
    const pidToBytes = new Map<number, number>([
      [1, 100],
      [2, 50],
      [3, 70]
    ])
    const result = aggregateRendererBytesByPlugin(rendererPidsByPlugin, pidToBytes)
    assert.equal(result.get('a'), 150)
    assert.equal(result.get('b'), 70)
  })

  it('treats unknown pids as 0 bytes', () => {
    const rendererPidsByPlugin = new Map<string, Set<number>>([['a', new Set([1, 999])]])
    const pidToBytes = new Map<number, number>([[1, 100]])
    assert.equal(aggregateRendererBytesByPlugin(rendererPidsByPlugin, pidToBytes).get('a'), 100)
  })
})
