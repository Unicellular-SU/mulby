import { app, clipboard, Notification, nativeImage } from 'electron'
import { statSync } from 'fs'
import { basename } from 'path'
import { PluginStorage } from './storage'
import { PluginFilesystem } from './filesystem'
import { PluginHttp, HttpRequestOptions } from './http'
import { pluginScreen, CaptureOptions, ScreenshotOptions, RecordingOptions } from './screen'
import { pluginShell } from './shell'
import { createPluginDialog } from './dialog'
import { pluginSystem } from './system'
import { createPluginGlobalShortcut } from './shortcut'
import { createPluginSecurity } from './security'
import { pluginMedia } from './media'
import { pluginPowerMonitor } from './power'
import { createPluginTray } from './tray'
import { pluginNetwork } from './network'
import { pluginInput } from './input'
import { permissionManager } from './permission-manager'
import { pluginInputMonitor, type GlobalInputEvent, type InputMonitorOptions, type InputEventCallback } from './input-monitor'
import { pluginFeatureStore, redirectHotKeySetting, redirectAiModelsSetting, registerMainPushHandler, registerMainPushSelectHandler, type MainPushAction, type MainPushItem } from './dynamic-features'
import { aiService } from '../ai'
import { aiSkillService } from '../ai/skills'
import type { DynamicFeatureInput, PluginMessage, PluginToolHandler } from '../../shared/types/plugin'
import type { PluginMessageBus } from './message-bus'
import type { TaskScheduler } from '../scheduler'
import type { TaskInput, TaskFilter } from '../scheduler/types'
import type { ClipboardHistoryManager } from '../services/clipboard-history'
import type {
  AiOption,
  AiMessage,
  AiImageGenerateProgressChunk,
  AiPromiseLike
} from '../../shared/types/ai'
import { commandRunnerService } from '../services/command-runner'
import { executeSharpOperations } from '../ipc/sharp'
import {
  createMissingPluginPermissionError,
  createSystemPermissionDeniedError,
  isMediaPermissionType,
  type MediaDevicePermissionType,
  type MediaPermissionType,
  type PluginManifestPermissionType
} from './media-permission-policy'
import type {
  StorageListOptions,
  StorageSetManyItem,
  StorageTransactionOp,
  StorageAppendOptions
} from '../../shared/types/storage-v2'
import log from 'electron-log'

const pluginStorage = new PluginStorage()
// PluginFilesystem 实例在 createPluginAPI 内部按插件名创建（实现跨插件数据隔离）
const pluginHttp = new PluginHttp()

type PluginPermissionApiType =
  | 'geolocation'
  | 'camera'
  | 'microphone'
  | 'screen'
  | 'accessibility'
  | 'contacts'
  | 'calendar'
  | 'notifications'

type NormalizedPluginPermissionApiType = Exclude<PluginPermissionApiType, 'notifications'> | 'notification'

interface CreatePluginApiOptions {
  runCommandAllowed?: boolean
  inputMonitorAllowed?: boolean
  microphoneAllowed?: boolean
  cameraAllowed?: boolean
  screenAllowed?: boolean
  geolocationAllowed?: boolean
  accessibilityAllowed?: boolean
  contactsAllowed?: boolean
  notificationAllowed?: boolean
  calendarAllowed?: boolean
  clipboardAllowed?: boolean
}

function toAbortablePromise<T>(promise: Promise<T>, abort: () => void): AiPromiseLike<T> {
  const abortable = promise as AiPromiseLike<T>
  abortable.abort = abort
  return abortable
}

// 创建插件可用的 API 上下文
export function createPluginAPI(
  pluginName: string,
  messageBus?: PluginMessageBus,
  taskScheduler?: TaskScheduler,
  clipboardHistoryManager?: ClipboardHistoryManager,
  options?: CreatePluginApiOptions
) {
  const runCommandAllowed = options?.runCommandAllowed === true
  const inputMonitorAllowed = options?.inputMonitorAllowed === true
  const allowedPluginPermissions: Record<PluginManifestPermissionType, boolean> = {
    microphone: options?.microphoneAllowed === true,
    camera: options?.cameraAllowed === true,
    screen: options?.screenAllowed === true,
    inputMonitor: inputMonitorAllowed,
    geolocation: options?.geolocationAllowed === true,
    accessibility: options?.accessibilityAllowed === true,
    contacts: options?.contactsAllowed === true,
    notification: options?.notificationAllowed === true,
    calendar: options?.calendarAllowed === true,
    clipboard: options?.clipboardAllowed === true
  }
  const hasPluginPermission = (type: PluginManifestPermissionType): boolean => {
    const allowed = allowedPluginPermissions[type] === true
    if (!allowed) {
      log.warn(`[PluginAPI:${pluginName}] Missing manifest permission: ${type}`)
    }
    return allowed
  }
  const ensurePluginPermission = (type: PluginManifestPermissionType): void => {
    if (!hasPluginPermission(type)) {
      throw createMissingPluginPermissionError(pluginName, type)
    }
  }
  const ensureMediaPermission = (type: MediaPermissionType): void => {
    ensurePluginPermission(type)
  }
  const manifestPermissionForPermissionApi = (type: PluginPermissionApiType): PluginManifestPermissionType | null => {
    if (type === 'notifications') return 'notification'
    return type
  }
  const normalizePermissionApiType = (type: PluginPermissionApiType): NormalizedPluginPermissionApiType => {
    return type === 'notifications' ? 'notification' : type
  }
  const ensurePermissionAccess = (type: PluginPermissionApiType): void => {
    if (isMediaPermissionType(type)) {
      ensureMediaPermission(type)
      return
    }
    const permission = manifestPermissionForPermissionApi(type)
    if (permission) ensurePluginPermission(permission)
  }
  // 为每个插件创建独立的 PluginFilesystem 实例（带插件名 → 启用跨插件数据隔离）
  const pluginFilesystem = new PluginFilesystem(pluginName)
  return {
    clipboard: {
      readText: () => {
        ensurePluginPermission('clipboard')
        return clipboard.readText()
      },
      writeText: (text: string) => {
        ensurePluginPermission('clipboard')
        clipboard.writeText(text)
        return Promise.resolve()
      },
      readImage: () => {
        ensurePluginPermission('clipboard')
        const image = clipboard.readImage()
        if (image.isEmpty()) return null
        return image.toPNG()
      },
      writeImage: (buffer: Buffer) => {
        ensurePluginPermission('clipboard')
        const image = nativeImage.createFromBuffer(buffer)
        clipboard.writeImage(image)
      },
      readFiles: () => {
        ensurePluginPermission('clipboard')
        // macOS: 优先使用 NSFilenamesPboardType（支持多文件）
        if (process.platform === 'darwin') {
          const nsFiles = clipboard.read('NSFilenamesPboardType')
          if (nsFiles) {
            // NSFilenamesPboardType 是 XML plist 格式
            const pathMatches = nsFiles.match(/<string>([^<]+)<\/string>/g)
            if (pathMatches && pathMatches.length > 0) {
              const paths = pathMatches
                .map(match => match.replace(/<\/?string>/g, ''))
                .filter(path => path.startsWith('/'))
              if (paths.length > 0) {
                return paths.map(filePath => {
                  try {
                    const stats = statSync(filePath)
                    return {
                      path: filePath,
                      name: basename(filePath),
                      size: stats.size,
                      isDirectory: stats.isDirectory()
                    }
                  } catch {
                    return { path: filePath, name: basename(filePath), size: 0, isDirectory: false }
                  }
                })
              }
            }
          }
          // 兜底：尝试 public.file-url（单文件）
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
        ensurePluginPermission('clipboard')
        // macOS 特有格式检测（与 ipc/clipboard.ts 保持一致）
        if (process.platform === 'darwin') {
          const nsFilenames = clipboard.read('NSFilenamesPboardType')
          if (nsFilenames && nsFilenames.includes('/')) return 'files'
          const publicFileUrl = clipboard.read('public.file-url')
          if (publicFileUrl && publicFileUrl.startsWith('file://')) return 'files'
        }
        if (clipboard.availableFormats().some(f => f.includes('file'))) return 'files'
        if (!clipboard.readImage().isEmpty()) return 'image'
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
        ensurePluginPermission('clipboard')
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        return clipboardHistoryManager.query(options || {})
      },
      get: async (id: string) => {
        ensurePluginPermission('clipboard')
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        return clipboardHistoryManager.getById(id)
      },
      copy: async (id: string) => {
        ensurePluginPermission('clipboard')
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
        ensurePluginPermission('clipboard')
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        clipboardHistoryManager.toggleFavorite(id)
        return { success: true }
      },
      delete: async (id: string) => {
        ensurePluginPermission('clipboard')
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        clipboardHistoryManager.delete(id)
        return { success: true }
      },
      clear: async () => {
        ensurePluginPermission('clipboard')
        if (!clipboardHistoryManager) {
          throw new Error('Clipboard history not available')
        }
        clipboardHistoryManager.clear()
        return { success: true }
      },
      stats: async () => {
        ensurePluginPermission('clipboard')
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
        ensurePluginPermission('notification')
        // 使用 setImmediate 确保不阻塞事件循环
        setImmediate(() => {
          new Notification({
            title: app.getName() || 'Mulby',
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
      keys: () => pluginStorage.keys(pluginName),
      has: (key: string) => pluginStorage.has(pluginName, key),
      getAll: () => pluginStorage.getAll(pluginName),
      bulkSet: (entries: Record<string, unknown>) => pluginStorage.bulkSet(pluginName, entries),
      // V2 扩展方法
      list: (options?: StorageListOptions) => pluginStorage.list(pluginName, options),
      getMany: (keys: string[]) => pluginStorage.getMany(pluginName, keys),
      setMany: (items: StorageSetManyItem[], options?: { atomic?: boolean }) => pluginStorage.setMany(pluginName, items, options),
      getMeta: (key: string) => pluginStorage.getMeta(pluginName, key),
      setWithVersion: (key: string, value: unknown, expectedVersion?: number | null) => pluginStorage.setWithVersion(pluginName, key, value, expectedVersion),
      removeWithVersion: (key: string, expectedVersion?: number) => pluginStorage.removeWithVersion(pluginName, key, expectedVersion),
      transaction: (ops: StorageTransactionOp[]) => pluginStorage.transaction(pluginName, ops),
      append: (key: string, chunk: unknown, options?: StorageAppendOptions) => pluginStorage.append(pluginName, key, chunk, options)
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
      basename: (path: string, ext?: string) => pluginFilesystem.basename(path, ext),
      getDataPath: (...subPaths: string[]) => pluginFilesystem.getDataPath(...subPaths)
    },
    http: {
      request: (options: HttpRequestOptions) => pluginHttp.request(options),
      get: (url: string, headers?: Record<string, string>) => pluginHttp.get(url, headers),
      post: (url: string, body?: string | object, headers?: Record<string, string>) => pluginHttp.post(url, body, headers),
      put: (url: string, body?: string | object, headers?: Record<string, string>) => pluginHttp.put(url, body, headers),
      delete: (url: string, headers?: Record<string, string>) => pluginHttp.delete(url, headers)
    },
    sharp: {
      execute: (payload: Parameters<typeof executeSharpOperations>[0]) => executeSharpOperations(payload)
    },
    screen: {
      getAllDisplays: () => pluginScreen.getAllDisplays(),
      getPrimaryDisplay: () => pluginScreen.getPrimaryDisplay(),
      getDisplayNearestPoint: (point: { x: number; y: number }) => pluginScreen.getDisplayNearestPoint(point),
      getCursorScreenPoint: () => pluginScreen.getCursorScreenPoint(),
      getSources: (options?: CaptureOptions) => {
        ensureMediaPermission('screen')
        return pluginScreen.getSources(options)
      },
      getWindowBounds: (sourceId: string) => {
        ensureMediaPermission('screen')
        return pluginScreen.getWindowBounds(sourceId)
      },
      capture: (options?: ScreenshotOptions) => {
        ensureMediaPermission('screen')
        return pluginScreen.captureScreen(options)
      },
      captureRegion: (
        region: { x: number; y: number; width: number; height: number },
        options?: Omit<ScreenshotOptions, 'sourceId'>
      ) => {
        ensureMediaPermission('screen')
        return pluginScreen.captureRegion(region, options)
      },
      getMediaStreamConstraints: (options: RecordingOptions) => {
        ensureMediaPermission('screen')
        return pluginScreen.getMediaStreamConstraints(options)
      }
    },
    shell: {
      openPath: (path: string) => pluginShell.openPath(path),
      openExternal: (url: string) => pluginShell.openExternal(url),
      showItemInFolder: (path: string) => pluginShell.showItemInFolder(path),
      openFolder: (path: string) => pluginShell.openFolder(path),
      trashItem: (path: string) => pluginShell.trashItem(path),
      beep: () => pluginShell.beep(),
      runCommand: async (input: {
        command: string
        args?: string[]
        cwd?: string
        env?: Record<string, string>
        timeoutMs?: number
        shell?: boolean
      }) => {
        return await commandRunnerService.runCommand(input, {
          source: 'plugin',
          pluginId: pluginName,
          runCommandAllowed
        })
      },
      getRunCommandPolicy: async () => {
        const policy = commandRunnerService.getPolicy()
        return {
          enabled: policy.enabled,
          requireConsent: policy.requireConsent,
          allowShell: policy.allowShell,
          allowList: policy.allowList,
          denyList: policy.denyList
        }
      },
      listRunCommandAudit: async (limit?: number) => {
        return commandRunnerService.listAudit(limit, pluginName)
      }
    },
    dialog: createPluginDialog(pluginName),
    system: {
      getSystemInfo: () => pluginSystem.getSystemInfo(),
      getAppInfo: () => pluginSystem.getAppInfo(),
      getPath: (name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos') => pluginSystem.getPath(name),
      getEnv: (name: string) => pluginSystem.getEnv(name),
      getIdleTime: () => pluginSystem.getIdleTime(),
      isMacOS: () => pluginSystem.isMacOS(),
      isWindows: () => pluginSystem.isWindows(),
      isLinux: () => pluginSystem.isLinux(),
      onActiveWindowChange: (callback: (info: import('../services/active-window').ActiveWindowInfo) => void) => pluginSystem.onActiveWindowChange(callback),
      getCachedActiveWindow: () => pluginSystem.getCachedActiveWindow(),
      getActiveWindow: () => pluginSystem.getActiveWindow(),
    },
    shortcut: createPluginGlobalShortcut(pluginName),
    security: createPluginSecurity(),
    media: {
      getAccessStatus: (mediaType: MediaDevicePermissionType) => {
        ensureMediaPermission(mediaType)
        return pluginMedia.getMediaAccessStatus(mediaType)
      },
      askForAccess: (mediaType: MediaDevicePermissionType) => {
        ensureMediaPermission(mediaType)
        return pluginMedia.askForMediaAccess(mediaType).then((granted) => {
          if (!granted) {
            log.warn(`[PluginAPI:${pluginName}] ${createSystemPermissionDeniedError(mediaType).message}`)
          }
          return granted
        })
      },
      hasCameraAccess: () => {
        ensureMediaPermission('camera')
        return pluginMedia.hasCameraAccess()
      },
      hasMicrophoneAccess: () => {
        ensureMediaPermission('microphone')
        return pluginMedia.hasMicrophoneAccess()
      }
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
      getStatus: (type: PluginPermissionApiType) => {
        ensurePermissionAccess(type)
        return permissionManager.getStatus(normalizePermissionApiType(type))
      },
      request: (type: PluginPermissionApiType) => {
        ensurePermissionAccess(type)
        return permissionManager.request(normalizePermissionApiType(type))
      },
      canRequest: (type: PluginPermissionApiType) => {
        ensurePermissionAccess(type)
        return permissionManager.canRequest(normalizePermissionApiType(type))
      },
      openSystemSettings: (type: PluginPermissionApiType) => {
        ensurePermissionAccess(type)
        return permissionManager.openSystemSettings(normalizePermissionApiType(type))
      },
      isAccessibilityTrusted: () => {
        ensurePluginPermission('accessibility')
        return permissionManager.isAccessibilityTrusted()
      }
    },
    features: {
      getFeatures: (codes?: string[]) => pluginFeatureStore.getFeatures(pluginName, codes),
      setFeature: (feature: DynamicFeatureInput) => {
        pluginFeatureStore.setFeature(pluginName, feature)
      },
      removeFeature: (code: string) => pluginFeatureStore.removeFeature(pluginName, code),
      redirectHotKeySetting: (cmdLabel: string, autocopy?: boolean) => {
        redirectHotKeySetting(cmdLabel, autocopy)
      },
      redirectAiModelsSetting: () => {
        redirectAiModelsSetting()
      },
      onMainPush: (callback: (action: MainPushAction) => MainPushItem[] | Promise<MainPushItem[]>) => {
        if (typeof callback !== 'function') return
        registerMainPushHandler(pluginName, callback)
      },
      onMainPushSelect: (callback: (action: MainPushAction & { option: MainPushItem }) => boolean | Promise<boolean>) => {
        if (typeof callback !== 'function') return
        registerMainPushSelectHandler(pluginName, callback)
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
      call: (option: AiOption, onChunk?: (chunk: AiMessage) => void) => {
        const optionWithContext: AiOption = {
          ...option,
          toolContext: { ...(option.toolContext || {}), pluginName }
        }

        if (!onChunk) {
          const promise = aiService.call(optionWithContext)
          return toAbortablePromise(promise, () => {})
        }

        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const promise = aiService
          .stream(
            optionWithContext,
            {
              onChunk: (chunk: AiMessage) => onChunk(chunk)
            },
            requestId
          )
        return toAbortablePromise(promise, () => {
          void aiService.abort(requestId)
        })
      },
      allModels: async () => aiService.allModels(),
      abort: (requestId: string) => aiService.abort(requestId),
      skills: {
        listEnabled: async () => {
          await aiSkillService.ensureCatalogLoaded()
          return aiSkillService.listEnabled()
        },
        previewForCall: async (input: { option?: Partial<AiOption>; skillIds?: string[]; prompt?: string }) => {
          await aiSkillService.ensureCatalogLoaded()
          return aiSkillService.preview(input)
        }
      },
      attachments: {
        upload: async (input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => await aiService.uploadAttachment(input),
        get: async (attachmentId: string) => await aiService.getAttachment(attachmentId),
        delete: async (attachmentId: string) => await aiService.deleteAttachment(attachmentId),
        uploadToProvider: async (input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }) =>
          await aiService.uploadAttachmentToProvider(input)
      },
      tokens: {
        estimate: async (input: { model: string; messages: AiMessage[] }) => await aiService.estimateTokens(input)
      },
      images: {
        generate: async (input: { prompt: string; model: string; size?: string; count?: number }) => await aiService.generateImages(input),
        generateStream: (
          input: { prompt: string; model: string; size?: string; count?: number },
          onChunk: (chunk: AiImageGenerateProgressChunk) => void
        ) => {
          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const promise = aiService.generateImagesStream(input, onChunk, requestId)
          return toAbortablePromise(promise, () => {
            void aiService.abort(requestId)
          })
        },
        edit: async (input: { imageAttachmentId: string; prompt: string; model: string }) => await aiService.editImage(input)
      },
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
    },
    inputMonitor: {
      isAvailable: () => {
        ensurePluginPermission('inputMonitor')
        return pluginInputMonitor.isAvailable()
      },
      requireAccessibility: () => {
        ensurePluginPermission('accessibility')
        return pluginInputMonitor.requireAccessibility()
      },
      start: (options?: InputMonitorOptions, callback?: InputEventCallback) => {
        ensurePluginPermission('inputMonitor')
        ensurePluginPermission('accessibility')
        return pluginInputMonitor.start(pluginName, options, callback)
      },
      stop: (sessionId: string) => {
        ensurePluginPermission('inputMonitor')
        return pluginInputMonitor.stop(pluginName, sessionId)
      },
      onEvent: (sessionId: string, callback: (event: GlobalInputEvent) => void) => {
        ensurePluginPermission('inputMonitor')
        return pluginInputMonitor.onEvent(sessionId, callback)
      }
    },
    // Plugin Tools API（主进程备用执行器使用，实际 handler 注册在 host-worker 内）
    tools: {
      register: (_name: string, _handler: PluginToolHandler) => {
        // 主进程备用执行器中 tools.register 为空操作
        // 实际的 handler 注册在 UtilityProcess (host-worker) 内完成
        log.warn('[PluginAPI] tools.register is only effective in UtilityProcess host-worker')
      },
      unregister: (_name: string) => {
        log.warn('[PluginAPI] tools.unregister is only effective in UtilityProcess host-worker')
      }
    }
  }
}

export type PluginAPI = ReturnType<typeof createPluginAPI>
