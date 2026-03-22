import { basename } from 'path'
import {
  normalizeSearchText,
  compactSearchText,
  getCachedKeywordIndex,
  isSubsequenceMatch
} from '../../../shared/search-matcher'
import type { AppSearchResult, FileSearchResult, SearchRankingContext } from './types'

export class SearchRanking implements SearchRankingContext {
  buildWildcardPattern(query: string): string | null {
    const compact = compactSearchText(query)
    if (compact.length < 2) return null
    return compact.split('').join('*')
  }

  mergeUniquePaths(base: string[], extra: string[], max: number): string[] {
    const merged: string[] = []
    const seen = new Set<string>()

    const append = (value: string) => {
      const normalized = value.trim()
      if (!normalized || seen.has(normalized)) return
      seen.add(normalized)
      merged.push(normalized)
    }

    base.forEach(append)
    extra.forEach(append)

    return merged.slice(0, max)
  }

  scoreText(text: string, query: string): number {
    const normalizedQuery = normalizeSearchText(query)
    const queryCompact = compactSearchText(query)
    if (!queryCompact) return 0

    const index = getCachedKeywordIndex(text)
    let score = 0

    if (index.normalized === normalizedQuery) score += 1300
    if (index.normalized.startsWith(normalizedQuery)) score += 1150
    if (index.normalized.includes(normalizedQuery)) score += 900
    if (index.compact.includes(queryCompact)) score += 820

    if (queryCompact.length >= 2) {
      if (index.latinInitials && index.latinInitials.includes(queryCompact)) score += 760
      if (index.pinyinInitials && index.pinyinInitials.includes(queryCompact)) score += 790
      if (index.pinyinFull && index.pinyinFull.includes(queryCompact)) score += 730
      if (isSubsequenceMatch(index.compact, queryCompact)) score += 540
      if (index.pinyinInitials && isSubsequenceMatch(index.pinyinInitials, queryCompact)) score += 510
    }

    return score
  }

  scoreApp(item: AppSearchResult, query: string, fallbackName?: string): number {
    const displayScore = this.scoreText(item.name, query)
    const fallback = fallbackName || this.normalizeAppDisplayName(basename(item.path))
    const fallbackScore = this.scoreText(fallback, query)
    const pathBaseScore = this.scoreText(this.normalizeAppDisplayName(basename(item.path)), query)
    return Math.max(displayScore, fallbackScore, pathBaseScore)
  }

  scoreFile(item: FileSearchResult, query: string): number {
    const nameScore = this.scoreText(item.name, query)
    const pathScore = this.scoreText(item.path, query)
    const normalizedQuery = normalizeSearchText(query)
    const directPathBoost = normalizedQuery && item.path.toLowerCase().includes(normalizedQuery) ? 80 : 0
    return Math.round(nameScore * 1.2 + pathScore * 0.45 + directPathBoost)
  }

  normalizeAppDisplayName(filename: string): string {
    return filename
      .replace(/\.app$/i, '')
      .replace(/\.lnk$/i, '')
      .replace(/\.exe$/i, '')
      .replace(/\.appref-ms$/i, '')
  }

  /**
   * 预计算应用名的拼音索引，使首次搜索零 pinyin-pro 调用开销。
   * 使用 setTimeout 分片执行，避免阻塞主线程。
   */
  preheatKeywordIndexes(names: string[]): void {
    const unique = Array.from(new Set(names.filter(Boolean)))
    if (unique.length === 0) return

    const BATCH_SIZE = 50
    let cursor = 0

    const processBatch = () => {
      const end = Math.min(cursor + BATCH_SIZE, unique.length)
      for (let i = cursor; i < end; i++) {
        getCachedKeywordIndex(unique[i])
      }
      cursor = end
      if (cursor < unique.length) {
        setTimeout(processBatch, 0)
      }
    }

    // 首批立即执行（同步），后续分片以避免阻塞
    processBatch()
  }
}
