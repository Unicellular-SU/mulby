import type { InputPayload, Plugin, PluginFeature } from '../../shared/types/plugin'
import { findBestMatch } from '../../shared/search-matcher'
import type { MatchType } from '../../shared/search-matcher'

export interface EmptyQuerySearchResult {
  plugin: Plugin
  feature: PluginFeature
  matchType: MatchType
}

export function getEmptyQuerySearchResults(
  plugins: Plugin[],
  input: InputPayload,
  getFeatures: (plugin: Plugin) => PluginFeature[]
): EmptyQuerySearchResult[] {
  if (!input.activeWindow) return []

  const results: EmptyQuerySearchResult[] = []
  for (const plugin of plugins) {
    for (const feature of getFeatures(plugin)) {
      const match = findBestMatch(feature, input)
      if (match?.matchType === 'window') {
        results.push({ plugin, feature, matchType: 'window' })
        break
      }
    }
  }
  return results
}
