const keyRotationState = new Map<string, number>()

export function normalizeApiKeyInput(value?: string): string {
  return String(value || '')
    .replace(/，/g, ',')
    .replace(/\n/g, ',')
    .trim()
}

export function splitApiKeyString(value?: string): string[] {
  const normalized = normalizeApiKeyInput(value)
  if (!normalized) return []

  return normalized
    .split(/(?<!\\),/)
    .map((key) => key.trim())
    .map((key) => key.replace(/\\,/g, ','))
    .filter(Boolean)
}

export function hasApiKey(value?: string): boolean {
  return splitApiKeyString(value).length > 0
}

export function getRotatedApiKey(value?: string, scope: string = 'default'): string | undefined {
  const keys = splitApiKeyString(value)
  if (keys.length === 0) return undefined
  if (keys.length === 1) return keys[0]

  const stateKey = `${scope}::${keys.join('\u0001')}`
  const cursor = keyRotationState.get(stateKey) ?? 0
  const index = ((cursor % keys.length) + keys.length) % keys.length
  const selected = keys[index]
  keyRotationState.set(stateKey, (index + 1) % keys.length)

  return selected
}
