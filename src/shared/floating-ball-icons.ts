export const MULBY_ICON_IDS = [
  'v1',
  'v2',
  'v3',
  'v4',
  'v5',
  'v6',
  'v7',
  'v8',
  'v9',
  'v10'
] as const

export type MulbyIconId = typeof MULBY_ICON_IDS[number]
export type FloatingBallIconId = 'label' | 'custom' | MulbyIconId

export const DEFAULT_FLOATING_BALL_ICON_ID: MulbyIconId = 'v1'
export const MAX_CUSTOM_FLOATING_BALL_ICON_BYTES = 200 * 1024

export function isMulbyIconId(value: unknown): value is MulbyIconId {
  return typeof value === 'string' && (MULBY_ICON_IDS as readonly string[]).includes(value)
}

export function isFloatingBallIconId(value: unknown): value is FloatingBallIconId {
  return value === 'label' || value === 'custom' || isMulbyIconId(value)
}

export function normalizeFloatingBallCustomSvg(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const svg = input.replace(/^\uFEFF/, '').trim()
  if (!svg || new TextEncoder().encode(svg).length > MAX_CUSTOM_FLOATING_BALL_ICON_BYTES) return undefined
  if (!/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(svg)) return undefined
  if (/<(?:script|foreignObject)\b/i.test(svg)) return undefined
  if (/<!doctype\b/i.test(svg)) return undefined
  if (/\son[a-z]+\s*=/i.test(svg)) return undefined
  if (/\b(?:href|xlink:href)\s*=\s*["']\s*(?:javascript:|https?:|file:)/i.test(svg)) return undefined
  if (/url\(\s*['"]?(?:javascript:|https?:|file:)/i.test(svg)) return undefined
  return svg
}
