import { basename } from 'path'
import { pinyin } from 'pinyin-pro'
import type { AppSearchResult, FileSearchResult, SearchRankingContext } from './types'

interface SearchNameIndex {
  normalized: string
  compact: string
  latinInitials: string
  pinyinFull: string
  pinyinInitials: string
}

const SEARCH_SEPARATOR_REGEX = /[\s\-_./\\|,:;，。！？、：；'"`‘’“”()（）[\]【】{}<>《》+*&^%$#@!~]+/g
const CAMEL_CASE_BOUNDARY_REGEX = /([a-z0-9])([A-Z])/g
const NON_ALNUM_REGEX = /[^a-z0-9]+/g

const MAX_INDEX_CACHE_SIZE = 6000

export class SearchRanking implements SearchRankingContext {
  private searchNameIndexCache: Map<string, SearchNameIndex> = new Map()

  private normalizeSearchText(value: string): string {
    return value.trim().toLowerCase().normalize('NFKC')
  }

  private compactSearchText(value: string): string {
    return this.normalizeSearchText(value).replace(SEARCH_SEPARATOR_REGEX, '')
  }

  private buildLatinInitials(value: string): string {
    const tokens = value
      .replace(CAMEL_CASE_BOUNDARY_REGEX, '$1 $2')
      .toLowerCase()
      .split(NON_ALNUM_REGEX)
      .filter(Boolean)
    return tokens.map((token) => token[0]).join('')
  }

  private buildPinyinIndexValue(value: string, pattern: 'pinyin' | 'first'): string {
    try {
      const converted = pinyin(value, {
        type: 'array',
        pattern,
        toneType: 'none',
        nonZh: 'consecutive',
        v: true
      })
      return this.compactSearchText(converted.join(''))
    } catch {
      return ''
    }
  }

  private getSearchNameIndex(value: string): SearchNameIndex {
    const cached = this.searchNameIndexCache.get(value)
    if (cached) {
      return cached
    }

    const index: SearchNameIndex = {
      normalized: this.normalizeSearchText(value),
      compact: this.compactSearchText(value),
      latinInitials: this.compactSearchText(this.buildLatinInitials(value)),
      pinyinFull: this.buildPinyinIndexValue(value, 'pinyin'),
      pinyinInitials: this.buildPinyinIndexValue(value, 'first')
    }

    if (this.searchNameIndexCache.size >= MAX_INDEX_CACHE_SIZE) {
      const oldestKey = this.searchNameIndexCache.keys().next().value as string | undefined
      if (oldestKey) {
        this.searchNameIndexCache.delete(oldestKey)
      }
    }
    this.searchNameIndexCache.set(value, index)

    return index
  }

  private isSubsequenceMatch(target: string, query: string): boolean {
    if (!target || !query || query.length > target.length) return false
    let pointer = 0
    for (const char of query) {
      pointer = target.indexOf(char, pointer)
      if (pointer === -1) return false
      pointer += 1
    }
    return true
  }

  buildWildcardPattern(query: string): string | null {
    const compact = this.compactSearchText(query)
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
    const normalizedQuery = this.normalizeSearchText(query)
    const queryCompact = this.compactSearchText(query)
    if (!queryCompact) return 0

    const index = this.getSearchNameIndex(text)
    let score = 0

    if (index.normalized === normalizedQuery) score += 1300
    if (index.normalized.startsWith(normalizedQuery)) score += 1150
    if (index.normalized.includes(normalizedQuery)) score += 900
    if (index.compact.includes(queryCompact)) score += 820

    if (queryCompact.length >= 2) {
      if (index.latinInitials && index.latinInitials.includes(queryCompact)) score += 760
      if (index.pinyinInitials && index.pinyinInitials.includes(queryCompact)) score += 790
      if (index.pinyinFull && index.pinyinFull.includes(queryCompact)) score += 730
      if (this.isSubsequenceMatch(index.compact, queryCompact)) score += 540
      if (index.pinyinInitials && this.isSubsequenceMatch(index.pinyinInitials, queryCompact)) score += 510
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
    const normalizedQuery = this.normalizeSearchText(query)
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
}
