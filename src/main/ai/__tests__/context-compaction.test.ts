import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compactToolResultMessages, computeCompactionMaxChars } from '../service/context-compaction'

describe('compactToolResultMessages', () => {
  it('is a no-op under budget (returns the same reference)', () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' }
    ]
    const out = compactToolResultMessages(msgs, { maxChars: 1000 })
    assert.equal(out, msgs)
  })

  it('shrinks old string tool results while keeping the recent ones and preserving pairing', () => {
    const big = 'x'.repeat(2000)
    const msgs: Array<Record<string, unknown>> = []
    for (let i = 0; i < 6; i += 1) {
      msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}` }] })
      msgs.push({ role: 'tool', tool_call_id: `c${i}`, content: big })
    }
    const before = msgs.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0)

    const out = compactToolResultMessages(msgs, { maxChars: 5000, keepRecentToolResults: 2 })
    assert.notEqual(out, msgs) // changed → new array

    const toolMsgs = out.filter((m) => m.role === 'tool')
    assert.equal(toolMsgs.length, 6)
    // tool_call_id 配对与顺序保持不变
    assert.deepEqual(
      toolMsgs.map((m) => m.tool_call_id),
      ['c0', 'c1', 'c2', 'c3', 'c4', 'c5']
    )
    // 最近 2 条工具结果仍完整
    assert.equal(toolMsgs[4].content, big)
    assert.equal(toolMsgs[5].content, big)
    // 最早的工具结果被占位（已缩小）
    assert.notEqual(toolMsgs[0].content, big)
    assert.ok((toolMsgs[0].content as string).length < big.length)

    const after = out.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0)
    assert.ok(after < before)
  })

  it('handles AI SDK tool-result parts (array content) without breaking ids', () => {
    const big = 'y'.repeat(3000)
    const msgs: Array<Record<string, unknown>> = []
    for (let i = 0; i < 4; i += 1) {
      msgs.push({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: `t${i}`, toolName: 'read', input: {} }] })
      msgs.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: `t${i}`, toolName: 'read', output: { type: 'text', value: big } }] })
    }

    const out = compactToolResultMessages(msgs, { maxChars: 4000, keepRecentToolResults: 1 })
    const toolMsgs = out.filter((m) => m.role === 'tool')
    type ToolPart = { toolCallId?: string; output?: { type?: string; value?: string } }
    const firstPart = (m: Record<string, unknown>): ToolPart => (m.content as ToolPart[])[0]
    // 配对 id 与顺序不变
    assert.deepEqual(
      toolMsgs.map((m) => firstPart(m).toolCallId),
      ['t0', 't1', 't2', 't3']
    )
    // 最近 1 条完整
    assert.equal(firstPart(toolMsgs[3]).output?.value, big)
    // 最早被占位，且仍是合法的 text 输出结构
    const firstOut = firstPart(toolMsgs[0]).output
    assert.equal(firstOut?.type, 'text')
    assert.notEqual(firstOut?.value, big)
  })

  it('never throws on malformed input and returns the original array', () => {
    const weird = [null, 42, { role: 'tool' }, { role: 'user', content: 'hello' }] as unknown[]
    const out = compactToolResultMessages(weird, { maxChars: 0, keepRecentToolResults: 0 })
    assert.ok(Array.isArray(out))
  })
})

describe('computeCompactionMaxChars', () => {
  it('returns undefined for unknown/zero context window', () => {
    assert.equal(computeCompactionMaxChars(undefined), undefined)
    assert.equal(computeCompactionMaxChars(0), undefined)
  })

  it('scales the budget with the model window (bigger window → bigger budget)', () => {
    const small = computeCompactionMaxChars(128_000, 16_384)
    const big = computeCompactionMaxChars(1_000_000, 64_000)
    assert.ok(small && big && big > small)
    // 128k window 预算应明显大于 8k 模型
    const tiny = computeCompactionMaxChars(8_000)
    assert.ok(tiny && small && small > tiny)
  })

  it('reserves output headroom (budget stays below the raw window in chars)', () => {
    const ctx = 128_000
    const budget = computeCompactionMaxChars(ctx, 16_384)!
    // 预算（字符）应小于 窗口×4（token→char），因为预留了输出 + buffer
    assert.ok(budget < ctx * 4)
  })
})
