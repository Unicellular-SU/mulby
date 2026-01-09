import { clipboard, Notification } from 'electron'
import { PluginStorage } from './storage'
import { PluginFilesystem } from './filesystem'

const pluginStorage = new PluginStorage()
const pluginFilesystem = new PluginFilesystem()

// 创建插件可用的 API 上下文
export function createPluginAPI(pluginName: string) {
  return {
    clipboard: {
      readText: () => clipboard.readText(),
      writeText: (text: string) => {
        clipboard.writeText(text)
        return Promise.resolve()
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
    }
  }
}

export type PluginAPI = ReturnType<typeof createPluginAPI>
