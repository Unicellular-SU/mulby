interface PluginContext {
  api: {
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
      readImage: () => ArrayBuffer | null
      getFormat: () => string
    }
    notification: {
      show: (message: string, type?: string) => void
    }
    features?: {
      getFeatures: (codes?: string[]) => Array<{ code: string }>
      setFeature: (feature: {
        code: string
        explain?: string
        icon?: string
        platform?: string | string[]
        mode?: 'ui' | 'silent' | 'detached'
        route?: string
        mainHide?: boolean
        mainPush?: boolean
        cmds: Array<string | { type: 'keyword' | 'regex'; value?: string; match?: string; explain?: string }>
      }) => void
      removeFeature: (code: string) => boolean
      redirectHotKeySetting: (cmdLabel: string, autocopy?: boolean) => void
      redirectAiModelsSetting: () => void
    }
  }
  input?: string
  featureCode?: string
}

export function onLoad() {
  console.log('[qrcode-helper] 插件已加载')
}

export function onUnload() {
  console.log('[qrcode-helper] 插件已卸载')
}

export function onEnable() {
  console.log('[qrcode-helper] 插件已启用')
}

export function onDisable() {
  console.log('[qrcode-helper] 插件已禁用')
}

export async function run(context: PluginContext) {
  const { notification } = context.api
  notification.show('插件已启动')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
