import type { WindowOptions } from '../../shared/types/plugin'

export interface AuxiliaryWindowSizeLimitOptions {
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  inheritWindowSizeLimits?: boolean
}

export interface AuxiliaryWindowSizeLimits {
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}

export function resolveAuxiliaryWindowSizeLimits(
  options: AuxiliaryWindowSizeLimitOptions | undefined,
  windowConfig: WindowOptions
): AuxiliaryWindowSizeLimits {
  const inheritWindowSizeLimits = options?.inheritWindowSizeLimits === true
  const resolved: AuxiliaryWindowSizeLimits = {}

  const minWidth = options?.minWidth ?? (inheritWindowSizeLimits ? windowConfig.minWidth : undefined)
  const minHeight = options?.minHeight ?? (inheritWindowSizeLimits ? windowConfig.minHeight : undefined)
  const maxWidth = options?.maxWidth ?? (inheritWindowSizeLimits ? windowConfig.maxWidth : undefined)
  const maxHeight = options?.maxHeight ?? (inheritWindowSizeLimits ? windowConfig.maxHeight : undefined)

  if (minWidth !== undefined) resolved.minWidth = minWidth
  if (minHeight !== undefined) resolved.minHeight = minHeight
  if (maxWidth !== undefined) resolved.maxWidth = maxWidth
  if (maxHeight !== undefined) resolved.maxHeight = maxHeight

  return resolved
}
