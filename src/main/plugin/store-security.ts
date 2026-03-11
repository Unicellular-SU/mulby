import { createHash } from 'node:crypto'

const LOCAL_HTTP_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]'
])

export type StoreTransportPolicy = 'secure' | 'local-http' | 'insecure' | 'invalid'

export function getStoreTransportPolicy(value: string): StoreTransportPolicy {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') {
      return 'secure'
    }
    if (url.protocol !== 'http:') {
      return 'invalid'
    }
    return LOCAL_HTTP_HOSTS.has(url.hostname.toLowerCase()) ? 'local-http' : 'insecure'
  } catch {
    return 'invalid'
  }
}

export function isAllowedStoreTransport(value: string): boolean {
  const policy = getStoreTransportPolicy(value)
  return policy === 'secure' || policy === 'local-http'
}

export function normalizeSha256(value: unknown): string | undefined {
  let normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.startsWith('sha256:')) {
    normalized = normalized.slice('sha256:'.length)
  }
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined
}

export function computeSha256Hex(input: Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}
