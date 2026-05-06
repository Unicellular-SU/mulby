import { app, Menu, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { ResolvedIcon } from '../../shared/types/plugin'
import { createNativeImageFromResolvedIcon } from './window-icon'
import {
  findFirstExistingIcon,
  getMacDockIconCandidates,
  getRuntimeIconRoots
} from './window-icon-paths'
import {
  buildMacDockMenuModel,
  resolveMacDockPresentation,
  type MacDockPluginWindowSnapshot,
  type MacDockPresentation
} from './mac-dock-presentation-model'
import log from 'electron-log'

const DOCK_ICON_SIZE = 512
const BADGE_BOX_SIZE = 218
const BADGE_ICON_SIZE = 168
const BADGE_MARGIN = 26
const CACHE_VERSION = 'v1'

export interface MacDockPresentationControllerOptions {
  getPluginWindows: () => MacDockPluginWindowSnapshot[]
  hasSystemDetachedWindow: () => boolean
  focusPluginWindow: (windowId: number) => void
  closePluginWindow: (windowId: number) => void
  stopPlugin: (pluginId: string) => void | Promise<unknown>
  focusSystemWindow: () => boolean
  openMainWindow: () => void
  quitMainProcess: () => void
  suppressActivateRouting?: (durationMs: number) => void
}

export class MacDockPresentationController {
  private refreshSeq = 0
  private defaultDockIconPromise: Promise<NativeImage | null> | null = null
  private dockVisible = false

  constructor(private readonly options: MacDockPresentationControllerOptions) {}

  refresh(): void {
    if (process.platform !== 'darwin' || !app.dock) return

    const seq = ++this.refreshSeq
    const presentation = resolveMacDockPresentation({
      pluginWindows: this.options.getPluginWindows(),
      hasSystemDetachedWindow: this.options.hasSystemDetachedWindow()
    })

    void this.applyPresentation(presentation, seq).catch((error) => {
      log.warn('[MacDock] Failed to refresh Dock presentation:', error)
    })
  }

  focusPrimaryWindow(): boolean {
    const presentation = resolveMacDockPresentation({
      pluginWindows: this.options.getPluginWindows(),
      hasSystemDetachedWindow: this.options.hasSystemDetachedWindow()
    })

    if (presentation.mode === 'system') {
      return this.options.focusSystemWindow()
    }

    const representative = presentation.representativePluginWindow
    if (!representative) return false
    this.options.focusPluginWindow(representative.windowId)
    return true
  }

  private async applyPresentation(
    presentation: MacDockPresentation,
    seq: number
  ): Promise<void> {
    if (!app.dock) return

    app.dock.setBadge(presentation.badge)
    app.dock.setMenu(this.buildDockMenu(presentation))

    if (presentation.mode === 'hidden') {
      if (this.dockVisible || this.isDockActuallyVisible()) {
        this.dockVisible = false
        this.options.suppressActivateRouting?.(250)
        void app.dock.hide()
      }
      const defaultIcon = await this.resolveDefaultDockIcon()
      if (seq === this.refreshSeq && defaultIcon && !defaultIcon.isEmpty()) {
        app.dock.setIcon(defaultIcon)
      }
      return
    }

    const icon = await this.resolveDockIcon(presentation)
    if (seq !== this.refreshSeq) return

    if (icon && !icon.isEmpty()) {
      app.dock.setIcon(icon)
    }

    if (!this.dockVisible || !this.isDockActuallyVisible()) {
      this.dockVisible = true
      try {
        this.options.suppressActivateRouting?.(250)
        await app.dock.show()
      } catch (error) {
        this.dockVisible = false
        throw error
      }
      if (seq !== this.refreshSeq) {
        this.refresh()
      }
    }
  }

  private isDockActuallyVisible(): boolean {
    try {
      return Boolean(app.dock?.isVisible())
    } catch {
      return this.dockVisible
    }
  }

  private async resolveDockIcon(
    presentation: MacDockPresentation
  ): Promise<NativeImage | null> {
    const defaultIcon = await this.resolveDefaultDockIcon()
    if (presentation.mode !== 'plugin') return defaultIcon

    const representative = presentation.representativePluginWindow
    if (!representative?.resolvedIcon) return defaultIcon

    return await this.createCompositeDockIcon(representative, defaultIcon)
      ?? defaultIcon
  }

  private async resolveDefaultDockIcon(): Promise<NativeImage | null> {
    if (!this.defaultDockIconPromise) {
      this.defaultDockIconPromise = this.loadDefaultDockIcon()
    }
    return this.defaultDockIconPromise
  }

  private async loadDefaultDockIcon(): Promise<NativeImage | null> {
    const roots = getRuntimeIconRoots({
      appPath: app.getAppPath(),
      cwd: process.cwd(),
      execPath: process.execPath,
      resourcesPath: process.resourcesPath
    })
    const iconPath = findFirstExistingIcon(getMacDockIconCandidates(roots))
    if (iconPath) {
      const image = nativeImage.createFromPath(iconPath)
      if (!image.isEmpty()) return image
    }

    try {
      const image = await app.getFileIcon(process.execPath, { size: 'large' })
      if (!image.isEmpty()) return image
    } catch (error) {
      log.warn('[MacDock] Failed to resolve default Dock icon:', error)
    }

    return null
  }

  private async createCompositeDockIcon(
    pluginWindow: MacDockPluginWindowSnapshot,
    defaultIcon: NativeImage | null
  ): Promise<NativeImage | null> {
    const resolvedIcon = pluginWindow.resolvedIcon
    if (!resolvedIcon) return defaultIcon

    const pluginIcon = createNativeImageFromResolvedIcon(resolvedIcon)
    if (!pluginIcon || pluginIcon.isEmpty()) return defaultIcon

    const baseIcon = defaultIcon && !defaultIcon.isEmpty() ? defaultIcon : pluginIcon
    const cachePath = this.getCompositeIconCachePath(
      pluginWindow.pluginId,
      resolvedIcon,
      baseIcon,
      pluginIcon
    )

    if (existsSync(cachePath)) {
      const cached = nativeImage.createFromPath(cachePath)
      if (!cached.isEmpty()) return cached
    }

    try {
      const buffer = await composeDockIconPng(baseIcon, pluginIcon)
      mkdirSync(join(app.getPath('userData'), 'dock-icons'), { recursive: true })
      writeFileSync(cachePath, buffer)
      const image = nativeImage.createFromBuffer(buffer)
      return image.isEmpty() ? pluginIcon : image
    } catch (error) {
      log.warn(`[MacDock] Failed to compose Dock icon for ${pluginWindow.pluginId}:`, error)
      return pluginIcon
    }
  }

  private getCompositeIconCachePath(
    pluginId: string,
    resolvedIcon: ResolvedIcon,
    baseIcon: NativeImage,
    pluginIcon: NativeImage
  ): string {
    const safePluginId = pluginId.replace(/[^a-zA-Z0-9._-]/g, '_')
    const hash = createHash('sha1')
      .update(CACHE_VERSION)
      .update(pluginId)
      .update(resolvedIcon.type)
      .update(resolvedIcon.value)
      .update(baseIcon.toPNG())
      .update(pluginIcon.toPNG())
      .digest('hex')
      .slice(0, 16)

    return join(app.getPath('userData'), 'dock-icons', `${safePluginId}-${hash}.png`)
  }

  private buildDockMenu(presentation: MacDockPresentation): Electron.Menu {
    const template: MenuItemConstructorOptions[] = buildMacDockMenuModel(presentation)
      .map((item): MenuItemConstructorOptions => {
        switch (item.type) {
          case 'separator':
            return { type: 'separator' }
          case 'plugin-window':
            return {
              label: item.label,
              submenu: [
                {
                  label: `显示 ${item.label}`,
                  click: () => this.options.focusPluginWindow(item.windowId)
                },
                {
                  label: '关闭窗口',
                  click: () => this.options.closePluginWindow(item.windowId)
                },
                {
                  label: '停止插件',
                  click: () => {
                    void this.options.stopPlugin(item.pluginId)
                  }
                }
              ]
            }
          case 'close-all-plugin-windows':
            return {
              label: item.label,
              click: () => {
                for (const windowInfo of presentation.pluginWindows) {
                  this.options.closePluginWindow(windowInfo.windowId)
                }
              }
            }
          case 'open-main-window':
            return {
              label: item.label,
              click: () => this.options.openMainWindow()
            }
          case 'quit-app':
            return {
              label: item.label,
              click: () => this.options.quitMainProcess()
            }
        }
      })

    return Menu.buildFromTemplate(template)
  }
}

async function composeDockIconPng(
  baseIcon: NativeImage,
  pluginIcon: NativeImage
): Promise<Buffer> {
  const baseBuffer = await sharp(baseIcon.toPNG())
    .resize(DOCK_ICON_SIZE, DOCK_ICON_SIZE, { fit: 'contain' })
    .png()
    .toBuffer()
  const pluginBuffer = await sharp(pluginIcon.toPNG())
    .resize(BADGE_ICON_SIZE, BADGE_ICON_SIZE, { fit: 'contain' })
    .png()
    .toBuffer()

  const badgeBackground = Buffer.from(`
    <svg width="${BADGE_BOX_SIZE}" height="${BADGE_BOX_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.28"/>
      </filter>
      <rect x="10" y="10" width="${BADGE_BOX_SIZE - 20}" height="${BADGE_BOX_SIZE - 20}" rx="52" fill="#ffffff" filter="url(#shadow)"/>
      <rect x="10.5" y="10.5" width="${BADGE_BOX_SIZE - 21}" height="${BADGE_BOX_SIZE - 21}" rx="51.5" fill="none" stroke="#0f172a" stroke-opacity="0.16" stroke-width="1"/>
    </svg>
  `)
  const badgeBuffer = await sharp(badgeBackground)
    .composite([{
      input: pluginBuffer,
      left: Math.round((BADGE_BOX_SIZE - BADGE_ICON_SIZE) / 2),
      top: Math.round((BADGE_BOX_SIZE - BADGE_ICON_SIZE) / 2)
    }])
    .png()
    .toBuffer()

  return await sharp(baseBuffer)
    .composite([{
      input: badgeBuffer,
      left: DOCK_ICON_SIZE - BADGE_BOX_SIZE - BADGE_MARGIN,
      top: DOCK_ICON_SIZE - BADGE_BOX_SIZE - BADGE_MARGIN
    }])
    .png()
    .toBuffer()
}
