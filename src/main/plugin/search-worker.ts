import type { SearchRequest, SearchResponse, SyncRequest } from './search-protocol'
import type { SearchPluginData } from './search-protocol'
import type { PluginFeature } from '../../shared/types/plugin'
import { findBestMatch, normalizeInputPayload } from '../../shared/search-matcher'

const parentPort = process.parentPort ?? null
const keepAliveTimer = setInterval(() => {
  // 保持 utility process 存活，使预热和首次搜索使用同一个 Worker
}, 60_000)

// 方案A: Worker 内部维护插件快照，search 时直接使用
let pluginSnapshot: SearchPluginData[] = []

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
  ) as SearchRequest | SyncRequest
  if (!payload) return

  // 处理 sync 消息：更新内部插件快照
  if (payload.type === 'sync') {
    pluginSnapshot = payload.payload.plugins
    send({
      id: payload.id,
      type: 'sync-ack',
      payload: {}
    })
    return
  }

  if (payload.type !== 'search') return

  try {
    const input = normalizeInputPayload(payload.payload.input)
    const results = []

    for (const plugin of pluginSnapshot) {
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
