import { clipboard, Notification, nativeImage } from 'electron'
import { statSync } from 'fs'
import { basename } from 'path'
import { PluginStorage } from './storage'
import { PluginFilesystem } from './filesystem'
import { PluginHttp, HttpRequestOptions } from './http'

const pluginStorage = new PluginStorage()
const pluginFilesystem = new PluginFilesystem()
const pluginHttp = new PluginHttp()

// 创建插件可用的 API 上下文
export function createPluginAPI(pluginName: string) {
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
    }
  }
}

export type PluginAPI = ReturnType<typeof createPluginAPI>
