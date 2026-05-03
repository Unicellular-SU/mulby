import type { LoadFileOptions } from 'electron'

export interface AuxiliaryPathParts {
  hash?: string
  search?: string
}

export function parseAuxiliaryPath(path: string): AuxiliaryPathParts {
  let remaining = path.trim()

  // Support legacy calls such as `/index.html#overlay` while still accepting
  // route-only values like `overlay` and `/overlay`.
  remaining = remaining.replace(/^\/?[^#?]*\.html(?=$|[#?])/, '')

  let search: string | undefined

  if (remaining.startsWith('?')) {
    const hashIndex = remaining.indexOf('#')
    if (hashIndex === -1) {
      search = remaining
      remaining = ''
    } else {
      search = remaining.slice(0, hashIndex)
      remaining = remaining.slice(hashIndex + 1)
    }
  } else {
    const hashIndex = remaining.indexOf('#')
    if (hashIndex !== -1) {
      remaining = remaining.slice(hashIndex + 1)
    }
  }

  remaining = remaining.replace(/^[/#]+/, '')

  const queryIndex = remaining.indexOf('?')
  if (queryIndex !== -1) {
    search = search ?? remaining.slice(queryIndex)
    remaining = remaining.slice(0, queryIndex)
  }

  const hash = remaining.replace(/^[/#]+/, '').replace(/\/+$/, '')
  return {
    ...(hash ? { hash } : {}),
    ...(search ? { search } : {})
  }
}

export function createAuxiliaryLoadFileOptions(parts: AuxiliaryPathParts): LoadFileOptions | undefined {
  const options: LoadFileOptions = {}
  if (parts.search) options.search = parts.search
  if (parts.hash) options.hash = parts.hash
  return options.search || options.hash ? options : undefined
}
