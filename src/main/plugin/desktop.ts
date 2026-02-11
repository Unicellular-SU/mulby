import { desktopSearchService } from './search/service'
import type { AppSearchResult, FileSearchResult } from './search/types'

export type { AppSearchResult, FileSearchResult } from './search/types'

export class PluginDesktop {
  warmupAppSearchIndex(): void {
    desktopSearchService.warmupAppSearchIndex()
  }

  async searchFiles(query: string, limit: number = 100): Promise<FileSearchResult[]> {
    return desktopSearchService.searchFiles(query, limit)
  }

  async searchApps(query: string, limit: number = 30): Promise<AppSearchResult[]> {
    return desktopSearchService.searchApps(query, limit)
  }
}

export const pluginDesktop = new PluginDesktop()
