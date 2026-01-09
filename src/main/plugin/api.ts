import { clipboard, Notification } from 'electron'
import { PluginStorage } from './storage'

const pluginStorage = new PluginStorage()

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
    }
  }
}

export type PluginAPI = ReturnType<typeof createPluginAPI>
