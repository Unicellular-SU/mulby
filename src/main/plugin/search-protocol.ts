import type { InputPayload, PluginCmd } from '../../shared/types/plugin'
import type { MatchType } from '../../shared/search-matcher'

export interface SearchPluginData {
  pluginId: string
  features: Array<{
    code: string
    cmds: PluginCmd[]
  }>
}

// 搜索请求：仅携带输入，插件数据已通过 sync 预同步
export interface SearchRequest {
  id: string
  type: 'search'
  payload: {
    input: InputPayload
  }
}

// 增量同步：当插件列表变更时，一次性同步完整插件数据到 Worker
export interface SyncRequest {
  id: string
  type: 'sync'
  payload: {
    plugins: SearchPluginData[]
  }
}

export interface SearchResultRef {
  pluginId: string
  featureCode: string
  matchType: MatchType
}

export interface SearchResultResponse {
  id: string
  type: 'result'
  payload: {
    results: SearchResultRef[]
  }
}

export interface SearchErrorResponse {
  id: string
  type: 'error'
  payload: {
    message: string
  }
}

export interface SearchReadyResponse {
  id: '__ready__'
  type: 'ready'
  payload: Record<string, never>
}

export interface SyncAckResponse {
  id: string
  type: 'sync-ack'
  payload: Record<string, never>
}

export type SearchResponse = SearchResultResponse | SearchErrorResponse | SearchReadyResponse | SyncAckResponse

