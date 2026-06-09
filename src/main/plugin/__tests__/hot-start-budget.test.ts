import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeHotStartBudget,
  computeFrecency,
  pickStartupPrewarmTargets
} from '../hot-start-budget'

const GiB = 1024 * 1024 * 1024

describe('computeHotStartBudget', () => {
  it('uses a conservative budget on low-memory machines (<8GB)', () => {
    const budget = computeHotStartBudget(4 * GiB)
    assert.equal(budget.residentUiCacheLimit, 4)
    assert.equal(budget.prewarmCacheLimit, 2)
    assert.equal(budget.hostPoolSize, 2)
  })

  it('keeps the historical defaults on a typical 8-16GB machine', () => {
    const budget = computeHotStartBudget(16 * GiB - 1)
    assert.equal(budget.residentUiCacheLimit, 6)
    assert.equal(budget.prewarmCacheLimit, 3)
    assert.equal(budget.hostPoolSize, 3)
    assert.equal(budget.startupPrewarmCount, 3)
  })

  it('scales up on 16-32GB and >=32GB machines', () => {
    const mid = computeHotStartBudget(24 * GiB)
    assert.equal(mid.residentUiCacheLimit, 10)
    assert.equal(mid.hostPoolSize, 4)

    const high = computeHotStartBudget(64 * GiB)
    assert.equal(high.residentUiCacheLimit, 14)
    assert.equal(high.hostPoolSize, 5)
  })

  it('falls back to the conservative tier for invalid memory readings', () => {
    const budget = computeHotStartBudget(0)
    assert.equal(budget.residentUiCacheLimit, 4)
    assert.equal(budget.hostPoolSize, 2)
  })
})

describe('computeFrecency', () => {
  it('applies no decay for usage within the last day', () => {
    const now = 1_000_000_000_000
    assert.equal(computeFrecency(now, 5, now), 5)
  })

  it('decays older usage by the documented tiers', () => {
    const now = 1_000_000_000_000
    const dayMs = 86_400_000
    // 3 天前 → 0.9 衰减
    assert.equal(computeFrecency(now - 3 * dayMs, 10, now), 9)
    // 100 天前 → 0.1 衰减
    assert.equal(Math.round(computeFrecency(now - 100 * dayMs, 10, now)), 1)
  })
})

describe('pickStartupPrewarmTargets', () => {
  it('dedupes by plugin (max frecency per plugin), sorts desc and limits', () => {
    const now = 1_000_000_000_000
    const dayMs = 86_400_000
    const targets = pickStartupPrewarmTargets(
      [
        { pluginId: 'a', lastUsedAt: now, useCount: 1 },          // a: 1.0
        { pluginId: 'a', lastUsedAt: now, useCount: 5 },          // a: 5.0 (max wins)
        { pluginId: 'b', lastUsedAt: now - 3 * dayMs, useCount: 10 }, // b: 9.0
        { pluginId: 'c', lastUsedAt: now - 100 * dayMs, useCount: 2 } // c: ~0.2
      ],
      2,
      now
    )
    assert.deepEqual(targets, ['b', 'a'])
  })

  it('returns an empty list when limit is non-positive', () => {
    assert.deepEqual(
      pickStartupPrewarmTargets([{ pluginId: 'a', lastUsedAt: Date.now(), useCount: 1 }], 0),
      []
    )
  })
})
