import type { SearchRequest, SearchResponse } from './search-protocol'
import type { PluginFeature } from '../../shared/types/plugin'
import { findBestMatch, normalizeInputPayload } from '../../shared/search-matcher'

const parentPort = process.parentPort ?? null
const keepAliveTimer = setInterval(() => {
  // Keep the utility process alive while idle so warmup and first search use the same worker.
}, 60_000)

function send(message: SearchResponse): void {
  if (parentPort) {
    parentPort.postMessage(message)
    return
  }
  if (typeof process.send === 'function') {
    process.send(message)
  }
}

const onMessage = (request: unknown) => {
  const payload = (
    typeof request === 'object' && request !== null && 'data' in request
      ? (request as { data?: unknown }).data
      : request
  ) as SearchRequest
  if (!payload || payload.type !== 'search') return

  try {
    const input = normalizeInputPayload(payload.payload.input)
    const results = []

    for (const plugin of payload.payload.plugins) {
      for (const feature of plugin.features) {
        const fullFeature: PluginFeature = {
          code: feature.code,
          explain: '',
          cmds: feature.cmds
        }
        const match = findBestMatch(fullFeature, input)
        if (match) {
          results.push({
            pluginId: plugin.pluginId,
            featureCode: feature.code,
            matchType: match.matchType
          })
        }
      }
    }

    send({
      id: payload.id,
      type: 'result',
      payload: { results }
    })
  } catch (error) {
    send({
      id: payload.id,
      type: 'error',
      payload: { message: error instanceof Error ? error.message : 'Search failed' }
    })
  }
}

if (parentPort) {
  parentPort.on('message', onMessage)
}
process.on('message', onMessage)

send({
  id: '__ready__',
  type: 'ready',
  payload: {}
})

process.on('disconnect', () => {
  clearInterval(keepAliveTimer)
  process.exit(0)
})
