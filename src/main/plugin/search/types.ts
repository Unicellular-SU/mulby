export interface FileSearchResult {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  score?: number
  source?: string
}

export interface AppSearchResult {
  name: string
  path: string
  kind: 'application' | 'shortcut' | 'executable'
  iconPath?: string
  score?: number
  source?: string
}

export interface SearchExecutionContext {
  runCommand(cmd: string, args: string[], limit: number, searchKey: string): Promise<string[]>
  runQuickCommand(cmd: string, args: string[], timeoutMs?: number): Promise<string>
  cancelSearchProcess(searchKey: string): void
  isKilledProcessError(error: unknown): boolean
}

export interface SearchRankingContext {
  buildWildcardPattern(query: string): string | null
  mergeUniquePaths(base: string[], extra: string[], max: number): string[]
  scoreText(text: string, query: string): number
  scoreApp(item: AppSearchResult, query: string, fallbackName?: string): number
  scoreFile(item: FileSearchResult, query: string): number
  normalizeAppDisplayName(filename: string): string
  preheatKeywordIndexes(names: string[]): void
}

export interface DesktopSearchProvider {
  warmupAppSearchIndex?(): void
  searchFiles(query: string, limit: number): Promise<FileSearchResult[]>
  searchApps(query: string, limit: number): Promise<AppSearchResult[]>
}
