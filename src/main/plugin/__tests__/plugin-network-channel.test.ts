import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  pluginNetworkChannel,
  PLUGIN_NETWORK_RECORD_EVENT,
  truncatePreview,
  normalizeHttpCall,
  type PluginNetworkRecord
} from '../plugin-network-channel'

describe('truncatePreview', () => {
  it('returns undefined for null/undefined', () => {
    assert.equal(truncatePreview(undefined), undefined)
    assert.equal(truncatePreview(null), undefined)
  })

  it('passes short strings through unchanged', () => {
    assert.equal(truncatePreview('hello'), 'hello')
  })

  it('truncates long strings and annotates the dropped length', () => {
    const long = 'a'.repeat(3000)
    const out = truncatePreview(long) as string
    assert.ok(out.length < long.length)
    assert.match(out, /…\s\(\+952 chars\)$/)
  })

  it('describes Buffer / ArrayBuffer by size, not content', () => {
    assert.equal(truncatePreview(Buffer.from('abc')), '<Buffer 3 bytes>')
    assert.equal(truncatePreview(new ArrayBuffer(8)), '<ArrayBuffer 8 bytes>')
  })

  it('JSON-stringifies plain objects', () => {
    assert.equal(truncatePreview({ a: 1 }), '{"a":1}')
  })

  it('returns undefined for non-serializable (circular) values instead of throwing', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    assert.equal(truncatePreview(circular), undefined)
  })
})

describe('normalizeHttpCall', () => {
  it('maps request(options)', () => {
    const out = normalizeHttpCall('request', [{ url: 'https://x/y', method: 'PATCH', headers: { a: '1' }, body: 'b' }])
    assert.deepEqual(out, { url: 'https://x/y', httpMethod: 'PATCH', headers: { a: '1' }, body: 'b' })
  })

  it('defaults request method to GET when omitted', () => {
    assert.equal(normalizeHttpCall('request', [{ url: 'https://x' }]).httpMethod, 'GET')
  })

  it('maps get(url, headers)', () => {
    assert.deepEqual(
      normalizeHttpCall('get', ['https://x', { h: '1' }]),
      { url: 'https://x', httpMethod: 'GET', headers: { h: '1' } }
    )
  })

  it('maps post(url, body, headers) with body in slot 1', () => {
    assert.deepEqual(
      normalizeHttpCall('post', ['https://x', { p: 1 }, { h: '1' }]),
      { url: 'https://x', httpMethod: 'POST', body: { p: 1 }, headers: { h: '1' } }
    )
  })

  it('maps delete(url, headers)', () => {
    assert.deepEqual(
      normalizeHttpCall('delete', ['https://x', { h: '1' }]),
      { url: 'https://x', httpMethod: 'DELETE', headers: { h: '1' } }
    )
  })
})

describe('pluginNetworkChannel gate + report', () => {
  it('enabled is false by default and reflects the injected gate', () => {
    // default gate
    pluginNetworkChannel.setGate(() => false)
    assert.equal(pluginNetworkChannel.enabled, false)
    pluginNetworkChannel.setGate(() => true)
    assert.equal(pluginNetworkChannel.enabled, true)
  })

  it('enabled returns false when the gate throws', () => {
    pluginNetworkChannel.setGate(() => { throw new Error('boom') })
    assert.equal(pluginNetworkChannel.enabled, false)
  })

  it('report emits (pluginId, record) and is suppressed when pluginId is empty', () => {
    const seen: Array<{ id: string; record: PluginNetworkRecord }> = []
    const listener = (id: string, record: PluginNetworkRecord) => seen.push({ id, record })
    pluginNetworkChannel.on(PLUGIN_NETWORK_RECORD_EVENT, listener)
    try {
      const record: PluginNetworkRecord = { source: 'mulby.http', method: 'GET', url: 'https://x', startedAt: 0 }
      pluginNetworkChannel.report('plugin.a', record)
      pluginNetworkChannel.report('', record) // suppressed: no pluginId
      assert.equal(seen.length, 1)
      assert.equal(seen[0].id, 'plugin.a')
      assert.equal(seen[0].record.url, 'https://x')
    } finally {
      pluginNetworkChannel.off(PLUGIN_NETWORK_RECORD_EVENT, listener)
      pluginNetworkChannel.setGate(() => false)
    }
  })
})
