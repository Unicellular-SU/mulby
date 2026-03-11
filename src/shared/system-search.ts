export const SYSTEM_SEARCH_MAX_QUERY_LENGTH = 160

const MULTILINE_QUERY_REGEX = /[\r\n]/

export function isSystemSearchQueryEligible(query: string): boolean {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return false
  if (normalizedQuery.length > SYSTEM_SEARCH_MAX_QUERY_LENGTH) return false
  return !MULTILINE_QUERY_REGEX.test(normalizedQuery)
}
