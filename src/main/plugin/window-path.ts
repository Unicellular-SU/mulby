import type { LoadFileOptions } from 'electron'
import { existsSync } from 'fs'
import { extname, isAbsolute, join, relative, resolve } from 'path'

export interface AuxiliaryPathParts {
  hash?: string
  search?: string
}

export interface LegacyAuxiliaryFileEntry {
  htmlPath: string
  loadFileOptions?: LoadFileOptions
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

function isInsideDirectory(basePath: string, targetPath: string): boolean {
  const relativePath = relative(basePath, targetPath)
  return relativePath === '' || (
    Boolean(relativePath) &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath)
  )
}

function parseFileUrlParts(input: string): { filePath: string; search?: string; hash?: string } {
  const trimmed = input.trim()
  const hashIndex = trimmed.indexOf('#')
  const beforeHash = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex)
  const rawHash = hashIndex === -1 ? undefined : trimmed.slice(hashIndex + 1)
  const queryIndex = beforeHash.indexOf('?')
  const filePath = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex)
  const search = queryIndex === -1 ? undefined : beforeHash.slice(queryIndex)
  const hash = rawHash ? rawHash.replace(/^\/+/, '') : undefined

  return {
    filePath,
    ...(search ? { search } : {}),
    ...(hash ? { hash } : {})
  }
}

export function resolvePluginRelativeFile(
  pluginPath: string,
  inputPath: string,
  allowedExtensions: readonly string[]
): string {
  if (inputPath.includes('\0')) {
    throw new Error('Path contains NUL byte')
  }

  const trimmed = inputPath.trim()
  if (!trimmed) {
    throw new Error('Path is empty')
  }
  if (isAbsolute(trimmed)) {
    throw new Error('Absolute paths are not allowed')
  }

  const normalizedPluginPath = resolve(pluginPath)
  const resolvedPath = resolve(join(normalizedPluginPath, trimmed))
  if (!isInsideDirectory(normalizedPluginPath, resolvedPath)) {
    throw new Error('Path escapes plugin directory')
  }

  const ext = extname(resolvedPath).toLowerCase()
  if (!allowedExtensions.includes(ext)) {
    throw new Error(`Unsupported file extension: ${ext || '(none)'}`)
  }

  return resolvedPath
}

export function resolveLegacyAuxiliaryFileEntry(pluginPath: string, url: string): LegacyAuxiliaryFileEntry {
  if (url.includes('\0')) {
    throw new Error('Path contains NUL byte')
  }

  const parts = parseFileUrlParts(url)
  const htmlPath = resolvePluginRelativeFile(pluginPath, parts.filePath, ['.html', '.htm'])
  if (!existsSync(htmlPath)) {
    throw new Error(`HTML file does not exist: ${parts.filePath}`)
  }

  return {
    htmlPath,
    loadFileOptions: createAuxiliaryLoadFileOptions({
      ...(parts.search ? { search: parts.search } : {}),
      ...(parts.hash ? { hash: parts.hash } : {})
    })
  }
}
