import { clipboard, Notification } from 'electron'

// 创建插件可用的 API 上下文
export function createPluginAPI() {
  return {
    clipboard: {
      readText: () => clipboard.readText(),
      writeText: (text: string) => {
        clipboard.writeText(text)
        return Promise.resolve()
      }
    },
    notification: {
      show: (message: string, type?: string) => {
        new Notification({
          title: 'InTools',
          body: message
        }).show()
      }
    }
  }
}

export type PluginAPI = ReturnType<typeof createPluginAPI>
