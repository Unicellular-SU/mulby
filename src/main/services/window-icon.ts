import { app, nativeImage, type NativeImage } from 'electron'
import type { Plugin, ResolvedIcon } from '../../shared/types/plugin'
import {
  findFirstExistingIcon,
  getAppWindowIconCandidates,
  getRuntimeIconRoots
} from './window-icon-paths'

export type WindowIcon = NativeImage | string | undefined

export function resolveAppWindowIcon(): string | undefined {
  const roots = getRuntimeIconRoots({
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    execPath: process.execPath,
    resourcesPath: process.resourcesPath
  })

  return findFirstExistingIcon(getAppWindowIconCandidates(roots))
}

export function resolvePluginWindowIcon(plugin: Pick<Plugin, 'resolvedIcon'>): WindowIcon {
  return createNativeImageFromResolvedIcon(plugin.resolvedIcon) ?? resolveAppWindowIcon()
}

export function createNativeImageFromResolvedIcon(icon: ResolvedIcon | undefined): NativeImage | undefined {
  if (!icon) return undefined

  try {
    const image = createImage(icon)
    if (!image || image.isEmpty()) return undefined
    return image
  } catch {
    return undefined
  }
}

function createImage(icon: ResolvedIcon): NativeImage | undefined {
  if (icon.type === 'data-url') {
    return nativeImage.createFromDataURL(icon.value)
  }

  if (icon.type === 'svg') {
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(icon.value, 'utf8').toString('base64')}`
    return nativeImage.createFromDataURL(dataUrl)
  }

  return undefined
}
