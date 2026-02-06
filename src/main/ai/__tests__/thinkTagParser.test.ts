import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createThinkTagStreamState,
  finalizeThinkTagStream,
  parseThinkTaggedChunk,
  splitThinkTaggedText
} from '../thinkTagParser'

describe('thinkTagParser', () => {
  it('splits full text into reasoning and content', () => {
    const result = splitThinkTaggedText('<think>先思考</think>最终答案')
    assert.equal(result.reasoning, '先思考')
    assert.equal(result.content, '最终答案')
  })

  it('keeps plain text in content', () => {
    const result = splitThinkTaggedText('普通回答')
    assert.equal(result.reasoning, '')
    assert.equal(result.content, '普通回答')
  })

  it('handles tag boundaries across stream chunks', () => {
    const state = createThinkTagStreamState()
    const a = parseThinkTaggedChunk('<th', state)
    const b = parseThinkTaggedChunk('ink>推理A', state)
    const c = parseThinkTaggedChunk('</th', state)
    const d = parseThinkTaggedChunk('ink>结果B', state)
    const tail = finalizeThinkTagStream(state)

    assert.equal(a.content, '')
    assert.equal(a.reasoning, '')
    assert.equal(b.reasoning, '推理A')
    assert.equal(c.reasoning, '')
    assert.equal(d.content, '结果B')
    assert.equal(tail.content, '')
    assert.equal(tail.reasoning, '')
  })

  it('supports alternative reasoning tags from providers', () => {
    const result = splitThinkTaggedText('<thought>中间推理</thought>最终文本')
    assert.equal(result.reasoning, '中间推理')
    assert.equal(result.content, '最终文本')
  })

  it('handles alternative tags across streaming chunks', () => {
    const state = createThinkTagStreamState('gemini-2.5-pro')
    const a = parseThinkTaggedChunk('<tho', state)
    const b = parseThinkTaggedChunk('ught>推理B</th', state)
    const c = parseThinkTaggedChunk('ought>答案B', state)
    const tail = finalizeThinkTagStream(state)

    assert.equal(a.content, '')
    assert.equal(a.reasoning, '')
    assert.equal(b.reasoning, '推理B')
    assert.equal(c.content, '答案B')
    assert.equal(tail.content, '')
    assert.equal(tail.reasoning, '')
  })
})
