import { app, Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '../../shared/types/settings'

const MAIN_TRAY_GUID = 'bfec5f16-92a2-4b89-b5a0-65f1678d0b9c'
const FALLBACK_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOqz9uoAAAAASUVORK5CYII='

export interface AppTrayCallbacks {
  toggleMainWindow: () => void
  openMainWindow: () => void
  openTrayMenu: (anchorBounds?: Electron.Rectangle) => void
  restartApp: () => void
  quitApp: () => void
}

export class AppTrayManager {
  private tray: Tray | null = null

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly callbacks: AppTrayCallbacks
  ) {}

  create(): boolean {
    const settings = this.getSettings()
    if (!settings.tray.enabled) {
      this.destroy()
      return false
    }

    this.destroy()

    try {
      const icon = this.resolveTrayIcon()
      this.tray = process.platform === 'darwin' || process.platform === 'win32'
        ? new Tray(icon, MAIN_TRAY_GUID)
        : new Tray(icon)

      this.tray.setToolTip('Mulby')
      if (process.platform === 'darwin' || process.platform === 'win32') {
        this.tray.setIgnoreDoubleClickEvents(true)
        this.tray.on('click', this.handleTrayActivation)
        this.tray.on('right-click', this.handleTrayContextMenu)
      } else {
        this.tray.setContextMenu(this.buildContextMenu())
        this.tray.on('click', this.handleTrayActivation)
      }

      return true
    } catch (error) {
      console.error('[AppTray] Failed to create tray:', error)
      this.destroy()
      return false
    }
  }

  destroy(): void {
    if (!this.tray) return
    this.tray.removeListener('click', this.handleTrayActivation)
    this.tray.removeListener('right-click', this.handleTrayContextMenu)
    this.tray.destroy()
    this.tray = null
  }

  isCreated(): boolean {
    return !!this.tray
  }

  private handleTrayActivation = (_event?: Electron.KeyboardEvent, bounds?: Electron.Rectangle) => {
    if (!this.tray) return

    const clickAction = this.getSettings().tray.clickAction
    if (clickAction === 'openMenu') {
      if (process.platform === 'linux') {
        this.tray.popUpContextMenu(this.buildContextMenu())
      } else {
        this.callbacks.openTrayMenu(bounds)
      }
      return
    }

    this.callbacks.toggleMainWindow()
  }

  private handleTrayContextMenu = (_event?: Electron.KeyboardEvent, bounds?: Electron.Rectangle) => {
    if (!this.tray) return
    if (process.platform === 'linux') {
      this.tray.popUpContextMenu(this.buildContextMenu())
      return
    }
    this.callbacks.openTrayMenu(bounds)
  }

  private buildContextMenu() {
    return Menu.buildFromTemplate([
      {
        label: '打开 Mulby',
        click: () => this.callbacks.openMainWindow()
      },
      { type: 'separator' },
      {
        label: '重启主进程',
        click: () => this.callbacks.restartApp()
      },
      {
        label: '退出 Mulby',
        click: () => this.callbacks.quitApp()
      }
    ])
  }

  private resolveTrayIcon(): Electron.NativeImage {
    const candidates = this.getIconCandidates()

    let image = nativeImage.createEmpty()
    for (const filePath of candidates) {
      if (!existsSync(filePath)) continue
      const next = nativeImage.createFromPath(filePath)
      if (!next.isEmpty()) {
        image = next
        break
      }
    }

    if (image.isEmpty()) {
      image = nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL)
    }

    const iconSize = process.platform === 'darwin' ? 18 : 16
    image = image.resize({ width: iconSize, height: iconSize })

    if (process.platform === 'darwin') {
      image.setTemplateImage(true)
    }

    return image
  }

  private getIconCandidates(): string[] {
    const appPath = app.getAppPath()
    const roots = [appPath, process.cwd(), process.resourcesPath]
    const uniqueRoots = Array.from(new Set(roots))

    if (process.platform === 'darwin') {
      return this.resolveCandidates(uniqueRoots, [
        'resources/tray/iconTemplate.png',
        'resources/tray/iconTemplate@2x.png',
        'resources/tray/icon.png'
      ])
    }

    if (process.platform === 'win32') {
      return this.resolveCandidates(uniqueRoots, [
        'resources/tray/icon.ico',
        'resources/tray/icon.png'
      ])
    }

    return this.resolveCandidates(uniqueRoots, [
      'resources/tray/icon.png',
      'resources/tray/iconTemplate.png'
    ])
  }

  private resolveCandidates(roots: string[], filenames: string[]): string[] {
    const out: string[] = []
    for (const root of roots) {
      for (const filename of filenames) {
        out.push(join(root, filename))
      }
    }
    return out
  }
}
