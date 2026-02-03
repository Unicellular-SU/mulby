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
import { aiService } from '../ai'
import type { DynamicFeatureInput, PluginMessage } from '../../shared/types/plugin'
import type { PluginMessageBus } from './message-bus'
import type { TaskScheduler } from '../scheduler'
import type { TaskInput, TaskFilter } from '../scheduler/types'
import type { ClipboardHistoryManager } from '../services/clipboard-history'
import type { AiOption, AiMessage } from '../../shared/types/ai'

const pluginStorage = new PluginStorage()
const pluginFilesystem = new PluginFilesystem()
const pluginHttp = new PluginHttp()

// 创建插件可用的 API 上下文
export function createPluginAPI(pluginName: string, messageBus?: PluginMessageBus, taskScheduler?: TaskScheduler, clipboardHistoryManager?: ClipboardHistoryManager) {
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
    clipboardHistory: {
      query: async (options?: {
        type?: 'text' | 'image' | 'files'
        search?: string
        favorite?: boolean
        limit?: number
        offset?: number
      }) => {
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        return clipboardHistoryManager.query(options || {})
      },
      get: async (id: string) => {
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        const items = clipboardHistoryManager.query({ limit: 1 })
        return items.find(item => item.id === id) || null
      },
      copy: async (id: string) => {
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        const items = clipboardHistoryManager.query({ limit: 1000 })
        const item = items.find(i => i.id === id)

        if (!item) return { success: false, error: 'Item not found' }

        try {
          if (item.type === 'text') {
            clipboard.writeText(item.content)
          } else if (item.type === 'image') {
            const base64 = item.content.replace(/^data:image\/\w+;base64,/, '')
            const buffer = Buffer.from(base64, 'base64')
            const image = nativeImage.createFromBuffer(buffer)
            clipboard.writeImage(image)
          } else if (item.type === 'files' && item.files) {
            // 文件复制需要特殊处理
            if (process.platform === 'darwin') {
              const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${item.files.map(p => `    <string>${p}</string>`).join('\n')}
</array>
</plist>`
              clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist))
            }
          }

          return { success: true }
        } catch (err) {
          return { success: false, error: String(err) }
        }
      },
      toggleFavorite: async (id: string) => {
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        clipboardHistoryManager.toggleFavorite(id)
        return { success: true }
      },
      delete: async (id: string) => {
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        clipboardHistoryManager.delete(id)
        return { success: true }
      },
      clear: async () => {
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        clipboardHistoryManager.clear()
        return { success: true }
      },
      stats: async () => {
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        const all = clipboardHistoryManager.query({ limit: 10000 })
        const text = all.filter(i => i.type === 'text').length
        const image = all.filter(i => i.type === 'image').length
        const files = all.filter(i => i.type === 'files').length
        const favorite = all.filter(i => i.favorite).length

        return {
          total: all.length,
          text,
          image,
          files,
          favorite
        }
      }
    },
    notification: {
      show: (message: string, _type?: string) => {
        // 使用 setImmediate 确保不阻塞事件循环
        setImmediate(() => {
          new Notification({
            title: 'InTools',
            body: message
          }).show()
        })
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
    },
    ai: {
      call: async (option: AiOption, onChunk?: (chunk: AiMessage) => void) => await aiService.call(option, onChunk),
      allModels: async () => aiService.allModels(),
      abort: (requestId: string) => aiService.abort(requestId),
      attachments: {
        upload: async (input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => await aiService.uploadAttachment(input),
        get: async (attachmentId: string) => await aiService.getAttachment(attachmentId),
        delete: async (attachmentId: string) => await aiService.deleteAttachment(attachmentId)
      },
      tokens: {
        estimate: async (input: { model: string; messages: AiMessage[] }) => await aiService.estimateTokens(input)
      },
      images: {
        generate: async (input: { prompt: string; model: string; size?: string; count?: number }) => await aiService.generateImages(input),
        edit: async (input: { imageAttachmentId: string; prompt: string; model: string }) => await aiService.editImage(input)
      },
      videos: {
        generate: async (input: { prompt: string; model: string; duration?: number; size?: string }) => await aiService.generateVideo(input)
      }
    },
    // Task Scheduler API
    scheduler: {
      schedule: async (task: TaskInput) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        return await taskScheduler.createTask({
          ...task,
          pluginId: pluginName
        })
      },
      cancel: async (taskId: string) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        await taskScheduler.cancelTask(taskId)
      },
      pause: async (taskId: string) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        await taskScheduler.pauseTask(taskId)
      },
      resume: async (taskId: string) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        await taskScheduler.resumeTask(taskId)
      },
      get: async (taskId: string) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        return await taskScheduler.getTask(taskId)
      },
      list: async (filter?: TaskFilter) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        return await taskScheduler.listTasks({
          ...filter,
          pluginId: pluginName
        })
      },
      getExecutions: async (taskId: string, limit?: number) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        return await taskScheduler.getExecutions(taskId, limit)
      },
      validateCron: (expression: string) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        return taskScheduler.validateCron(expression)
      },
      getNextCronTime: (expression: string, after?: Date) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        return taskScheduler.getNextCronTime(expression, after)
      },
      describeCron: (expression: string) => {
        if (!taskScheduler) {
          throw new Error('Task scheduler not available')
        }
        return taskScheduler.describeCron(expression)
      }
    }
  }
}

export type PluginAPI = ReturnType<typeof createPluginAPI>
