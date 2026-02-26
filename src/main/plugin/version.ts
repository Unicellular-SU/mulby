interface ParsedVersion {
  valid: boolean
  core: number[]
  prerelease: string[]
  raw: string
}

function parseVersion(input: string): ParsedVersion {
  const raw = String(input || '').trim()
  if (!raw) {
    return { valid: false, core: [], prerelease: [], raw }
  }

  const [mainPart] = raw.split('+')
  const [corePart = '', prereleasePart = ''] = mainPart.split('-', 2)
  const coreSegments = corePart.split('.')
  const core: number[] = []

  for (const segment of coreSegments) {
    if (!/^\d+$/.test(segment)) {
      return { valid: false, core: [], prerelease: [], raw }
    }
    core.push(Number(segment))
  }

  const prerelease = prereleasePart
    ? prereleasePart.split('.').filter((item) => item.length > 0)
    : []

  return {
    valid: true,
    core,
    prerelease,
    raw
  }
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue

    const leftIsNum = /^\d+$/.test(left)
    const rightIsNum = /^\d+$/.test(right)
    if (leftIsNum && rightIsNum) {
      const diff = Number(left) - Number(right)
      if (diff !== 0) return diff > 0 ? 1 : -1
      continue
    }
    if (leftIsNum !== rightIsNum) {
      return leftIsNum ? -1 : 1
    }
    return left.localeCompare(right)
  }

  return 0
}

/**
 * Compare version strings.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a)
  const parsedB = parseVersion(b)

  if (!parsedA.valid || !parsedB.valid) {
    const fallback = String(a || '').localeCompare(String(b || ''))
    return fallback > 0 ? 1 : fallback < 0 ? -1 : 0
  }

  const max = Math.max(parsedA.core.length, parsedB.core.length)
  for (let i = 0; i < max; i += 1) {
    const left = parsedA.core[i] ?? 0
    const right = parsedB.core[i] ?? 0
    if (left === right) continue
    return left > right ? 1 : -1
  }

  return comparePrerelease(parsedA.prerelease, parsedB.prerelease)
}
