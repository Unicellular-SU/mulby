import type { InputPayload, PluginCmd } from '../../shared/types/plugin'
import type { MatchType } from '../../shared/search-matcher'

export interface SearchPluginData {
  pluginId: string
  features: Array<{
    code: string
    cmds: PluginCmd[]
  }>
}

export interface SearchRequest {
  id: string
  type: 'search'
  payload: {
    input: InputPayload
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

export type SearchResponse = SearchResultResponse | SearchErrorResponse
