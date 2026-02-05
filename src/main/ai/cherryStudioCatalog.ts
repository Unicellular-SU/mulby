import catalog from './cherryStudioCatalog.json'
import type { AiModelCapability } from '../../shared/types/ai'

export interface CherryStudioCatalogEntry {
  id: string
  name: string
  provider: string
  group?: string
  capabilities?: AiModelCapability[]
}

const CATALOG = (catalog as CherryStudioCatalogEntry[]) || []
const CATALOG_INDEX = new Map<string, CherryStudioCatalogEntry[]>()

function normalizeModelKey(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const withoutProvider = raw.includes(':') ? raw.split(':', 2)[1] : raw
  const parts = withoutProvider.split('/')
  let base = parts[parts.length - 1]?.toLowerCase() || ''
  if (base.endsWith(':free')) base = base.replace(':free', '')
  if (base.endsWith('(free)')) base = base.replace('(free)', '')
  if (base.endsWith(':cloud')) base = base.replace(':cloud', '')
  return base
}

function indexCatalogEntry(entry: CherryStudioCatalogEntry) {
  const keys = [entry.id, entry.name].map((item) => normalizeModelKey(item)).filter(Boolean)
  keys.forEach((key) => {
    const list = CATALOG_INDEX.get(key) || []
    list.push(entry)
    CATALOG_INDEX.set(key, list)
  })
}

CATALOG.forEach((entry) => indexCatalogEntry(entry))

export function findCherryStudioCatalogEntry(modelIdOrName?: string): CherryStudioCatalogEntry | undefined {
  if (!modelIdOrName) return undefined
  const key = normalizeModelKey(modelIdOrName)
  const matches = CATALOG_INDEX.get(key)
  if (!matches || matches.length === 0) return undefined
  return matches[0]
}

export function getCherryStudioCatalog(): CherryStudioCatalogEntry[] {
  return CATALOG
}

export function normalizeCherryStudioModelKey(input: string): string {
  return normalizeModelKey(input)
}
