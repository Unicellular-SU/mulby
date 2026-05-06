import { existsSync } from 'fs'
import { dirname, join } from 'path'

export interface RuntimeIconRootInput {
  appPath: string
  cwd?: string
  execPath?: string
  resourcesPath?: string
}

export function getRuntimeIconRoots(input: RuntimeIconRootInput): string[] {
  const roots = [
    input.appPath,
    dirname(input.appPath),
    input.cwd,
    input.resourcesPath,
    input.resourcesPath ? join(input.resourcesPath, 'app.asar.unpacked') : undefined,
    input.execPath ? dirname(input.execPath) : undefined
  ]

  return Array.from(new Set(roots.filter((root): root is string => Boolean(root))))
}

export function getAppWindowIconCandidates(
  roots: string[],
  platform: NodeJS.Platform = process.platform
): string[] {
  const relativeCandidates = platform === 'win32'
    ? [
      join('resources', 'tray', 'icon.ico'),
      join('build', 'icon.ico'),
      'icon.ico',
      join('resources', 'tray', 'icon.png'),
      join('build', 'icon.png'),
      'icon.png'
    ]
    : [
      join('resources', 'tray', 'icon.png'),
      join('build', 'icon.png'),
      'icon.png'
    ]

  return roots.flatMap((root) =>
    relativeCandidates.map((candidate) => join(root, candidate))
  )
}

export function getMacDockIconCandidates(roots: string[]): string[] {
  const relativeCandidates = [
    join('build', 'icon.png'),
    'icon.png',
    join('resources', 'tray', 'icon.png')
  ]

  return roots.flatMap((root) =>
    relativeCandidates.map((candidate) => join(root, candidate))
  )
}

export function findFirstExistingIcon(
  candidates: string[],
  exists: (candidate: string) => boolean = existsSync
): string | undefined {
  return candidates.find((candidate) => exists(candidate))
}
