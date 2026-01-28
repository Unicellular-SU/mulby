import { clipboard, Notification, nativeImage } from 'electron'
import { statSync } from 'fs'
import { basename } from 'path'
import { PluginStorage } from './storage'
import { PluginFilesystem } from './filesystem'
import { PluginHttp, HttpRequestOptions } from './http'
import { pluginScreen, CaptureOptions, ScreenshotOptions, RecordingOptions } from './screen'
import { pluginShell } from './shell'
import { pluginDialog, OpenDialogOptions, SaveDialogOptions, MessageBoxOptions } from './dialog'
import { pluginSystem } from './system'
import { createPluginGlobalShortcut } from './shortcut'
import { createPluginSecurity } from './security'
import { pluginMedia } from './media'
import { pluginPowerMonitor } from './power'
import { createPluginTray } from './tray'
import { pluginNetwork } from './network'
import { pluginInput } from './input'
import { permissionManager } from './permission-manager'
import { pluginFeatureStore, redirectHotKeySetting, redirectAiModelsSetting } from './dynamic-features'
import type { DynamicFeatureInput, PluginMessage } from '../../shared/types/plugin'
import type { PluginMessageBus } from './message-bus'

const pluginStorage = new PluginStorage()
const pluginFilesystem = new PluginFilesystem()
const pluginHttp = new PluginHttp()

// 创建插件可用的 API 上下文
export function createPluginAPI(pluginName: string, messageBus?: PluginMessageBus) {
  return {
    clipboard: {
      readText: () => clipboard.readText(),
      writeText: (text: string) => {
        clipboard.writeText(text)
        return Promise.resolve()
      },
      readImage: () => {
        const image = clipboard.readImage()
        if (image.isEmpty()) return null
        return image.toPNG()
      },
      writeImage: (buffer: Buffer) => {
        const image = nativeImage.createFromBuffer(buffer)
        clipboard.writeImage(image)
      },
      readFiles: () => {
        // macOS: 通过 file URL 读取
        if (process.platform === 'darwin') {
          const rawFiles = clipboard.read('public.file-url')
          if (rawFiles) {
            const filePath = decodeURIComponent(rawFiles.replace('file://', ''))
            try {
              const stats = statSync(filePath)
              return [{
                path: filePath,
                name: basename(filePath),
                size: stats.size,
                isDirectory: stats.isDirectory()
              }]
            } catch {
              return []
            }
          }
        }
        // Windows/Linux: 通过 buffer 读取
        const rawFilePaths = clipboard.readBuffer('FileNameW')
        if (rawFilePaths && rawFilePaths.length > 0) {
          const paths = rawFilePaths.toString('ucs2').replace(/\0+$/, '').split('\0')
          return paths.filter(p => p).map(filePath => {
            try {
              const stats = statSync(filePath)
              return {
                path: filePath,
                name: basename(filePath),
                size: stats.size,
                isDirectory: stats.isDirectory()
              }
            } catch {
              return null
            }
          }).filter((item): item is NonNullable<typeof item> => item !== null)
        }
        return []
      },
      getFormat: () => {
        if (clipboard.availableFormats().some(f => f.includes('image'))) return 'image'
        if (clipboard.availableFormats().some(f => f.includes('file'))) return 'files'
        if (clipboard.readText()) return 'text'
        return 'empty'
      }
    },
    notification: {
      show: (message: string, _type?: string) => {
        new Notification({
          title: 'InTools',
          body: message
        }).show()
      }
    },
    storage: {
      get: (key: string) => pluginStorage.get(pluginName, key),
      set: (key: string, value: unknown) => pluginStorage.set(pluginName, key, value),
      remove: (key: string) => pluginStorage.remove(pluginName, key),
      clear: () => pluginStorage.clear(pluginName),
      keys: () => pluginStorage.keys(pluginName)
    },
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') => pluginFilesystem.readFile(path, encoding),
      writeFile: (path: string, data: string | Buffer, encoding?: 'utf-8' | 'base64') => pluginFilesystem.writeFile(path, data, encoding),
      exists: (path: string) => pluginFilesystem.exists(path),
      unlink: (path: string) => pluginFilesystem.unlink(path),
      readdir: (path: string) => pluginFilesystem.readdir(path),
      mkdir: (path: string) => pluginFilesystem.mkdir(path),
      stat: (path: string) => pluginFilesystem.stat(path),
      copy: (src: string, dest: string) => pluginFilesystem.copy(src, dest),
      move: (src: string, dest: string) => pluginFilesystem.move(src, dest),
      extname: (path: string) => pluginFilesystem.extname(path),
      join: (...paths: string[]) => pluginFilesystem.join(...paths),
      dirname: (path: string) => pluginFilesystem.dirname(path),
      basename: (path: string, ext?: string) => pluginFilesystem.basename(path, ext)
    },
    http: {
      request: (options: HttpRequestOptions) => pluginHttp.request(options),
      get: (url: string, headers?: Record<string, string>) => pluginHttp.get(url, headers),
      post: (url: string, body?: string | object, headers?: Record<string, string>) => pluginHttp.post(url, body, headers),
      put: (url: string, body?: string | object, headers?: Record<string, string>) => pluginHttp.put(url, body, headers),
      delete: (url: string, headers?: Record<string, string>) => pluginHttp.delete(url, headers)
    },
    screen: {
      getAllDisplays: () => pluginScreen.getAllDisplays(),
      getPrimaryDisplay: () => pluginScreen.getPrimaryDisplay(),
      getDisplayNearestPoint: (point: { x: number; y: number }) => pluginScreen.getDisplayNearestPoint(point),
      getCursorScreenPoint: () => pluginScreen.getCursorScreenPoint(),
      getSources: (options?: CaptureOptions) => pluginScreen.getSources(options),
      capture: (options?: ScreenshotOptions) => pluginScreen.captureScreen(options),
      captureRegion: (
        region: { x: number; y: number; width: number; height: number },
        options?: Omit<ScreenshotOptions, 'sourceId'>
      ) => pluginScreen.captureRegion(region, options),
      getMediaStreamConstraints: (options: RecordingOptions) => pluginScreen.getMediaStreamConstraints(options)
    },
    shell: {
      openPath: (path: string) => pluginShell.openPath(path),
      openExternal: (url: string) => pluginShell.openExternal(url),
      showItemInFolder: (path: string) => pluginShell.showItemInFolder(path),
      openFolder: (path: string) => pluginShell.openFolder(path),
      trashItem: (path: string) => pluginShell.trashItem(path),
      beep: () => pluginShell.beep()
    },
    dialog: {
      showOpenDialog: (options?: OpenDialogOptions) => pluginDialog.showOpenDialog(options),
      showSaveDialog: (options?: SaveDialogOptions) => pluginDialog.showSaveDialog(options),
      showMessageBox: (options: MessageBoxOptions) => pluginDialog.showMessageBox(options),
      showErrorBox: (title: string, content: string) => pluginDialog.showErrorBox(title, content)
    },
    system: {
      getSystemInfo: () => pluginSystem.getSystemInfo(),
      getAppInfo: () => pluginSystem.getAppInfo(),
      getPath: (name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos') => pluginSystem.getPath(name),
      getEnv: (name: string) => pluginSystem.getEnv(name),
      getIdleTime: () => pluginSystem.getIdleTime()
    },
    shortcut: createPluginGlobalShortcut(pluginName),
    security: createPluginSecurity(),
    media: {
      getAccessStatus: (mediaType: 'microphone' | 'camera') => pluginMedia.getMediaAccessStatus(mediaType),
      askForAccess: (mediaType: 'microphone' | 'camera') => pluginMedia.askForMediaAccess(mediaType),
      hasCameraAccess: () => pluginMedia.hasCameraAccess(),
      hasMicrophoneAccess: () => pluginMedia.hasMicrophoneAccess()
    },
    power: {
      getSystemIdleTime: () => pluginPowerMonitor.getSystemIdleTime(),
      getSystemIdleState: (idleThreshold: number) => pluginPowerMonitor.getSystemIdleState(idleThreshold),
      isOnBatteryPower: () => pluginPowerMonitor.isOnBatteryPower(),
      getCurrentThermalState: () => pluginPowerMonitor.getCurrentThermalState()
    },
    tray: createPluginTray(pluginName),
    network: {
      isOnline: () => pluginNetwork.isOnline()
    },
    input: pluginInput,
    permission: {
      getStatus: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        permissionManager.getStatus(type),
      request: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        permissionManager.request(type),
      canRequest: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        permissionManager.canRequest(type),
      openSystemSettings: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar') =>
        permissionManager.openSystemSettings(type),
      isAccessibilityTrusted: () => permissionManager.isAccessibilityTrusted()
    },
    features: {
      getFeatures: (codes?: string[]) => pluginFeatureStore.getFeatures(pluginName, codes),
      setFeature: (feature: DynamicFeatureInput) => {
        pluginFeatureStore.setFeature(pluginName, feature)
      },
      removeFeature: (code: string) => pluginFeatureStore.removeFeature(pluginName, code),
      redirectHotKeySetting: (cmdLabel: string, _autocopy?: boolean) => {
        redirectHotKeySetting(cmdLabel)
      },
      redirectAiModelsSetting: () => {
        redirectAiModelsSetting()
      }
    },
    // Phase 4: 插件间通信 API
    messaging: {
      send: async (targetPluginId: string, type: string, payload: unknown) => {
        if (!messageBus) {
          throw new Error('Message bus not available')
        }
        await messageBus.send(pluginName, targetPluginId, type, payload)
      },
      broadcast: async (type: string, payload: unknown) => {
        if (!messageBus) {
          throw new Error('Message bus not available')
        }
        await messageBus.broadcast(pluginName, type, payload)
      },
      on: (handler: (message: PluginMessage) => void | Promise<void>) => {
        if (!messageBus) {
          throw new Error('Message bus not available')
        }
        messageBus.subscribe(pluginName, handler)
      },
      off: (handler?: (message: PluginMessage) => void | Promise<void>) => {
        if (!messageBus) {
          throw new Error('Message bus not available')
        }
        messageBus.unsubscribe(pluginName, handler)
      }
    }
  }
}

export type PluginAPI = ReturnType<typeof createPluginAPI>
