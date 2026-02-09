import type { AiTool } from '../../shared/types/ai'

function toCanonicalToolName(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0))
  for (let i = 0; i < rows; i += 1) dp[i][0] = i
  for (let j = 0; j < cols; j += 1) dp[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  return dp[a.length][b.length]
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  const distance = levenshteinDistance(a, b)
  return 1 - distance / maxLen
}

function getToolFunctionNames(tools: AiTool[]): string[] {
  const names = new Set<string>()
  for (const tool of tools) {
    const name = tool?.type === 'function' ? String(tool.function?.name || '').trim() : ''
    if (!name) continue
    names.add(name)
  }
  return [...names]
}

export function resolveCompatToolCallName(rawName: unknown, tools: AiTool[]): string | undefined {
  const source = String(rawName || '').trim()
  if (!source) return undefined
  const names = getToolFunctionNames(tools)
  if (names.length === 0) return undefined

  if (names.includes(source)) return source

  const lower = source.toLowerCase()
  const caseInsensitive = names.find((name) => name.toLowerCase() === lower)
  if (caseInsensitive) return caseInsensitive

  const canonical = toCanonicalToolName(source)
  const canonicalMatches = names.filter((name) => toCanonicalToolName(name) === canonical)
  if (canonicalMatches.length === 1) return canonicalMatches[0]

  if (names.length === 1) return names[0]

  if (canonical.endsWith('runcommand')) {
    const runCommandNames = names.filter((name) => toCanonicalToolName(name).endsWith('runcommand'))
    if (runCommandNames.length === 1) return runCommandNames[0]
  }

  const scored = names
    .map((name) => ({ name, score: similarity(canonical, toCanonicalToolName(name)) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (!best) return undefined
  const scoreGap = second ? best.score - second.score : best.score
  if (best.score >= 0.86 && scoreGap >= 0.08) {
    return best.name
  }

  return undefined
}

