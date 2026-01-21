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
        cmds: Array<
          | string
          | { type: 'keyword'; value: string; explain?: string }
          | { type: 'regex'; match: string; explain?: string; label?: string; minLength?: number; maxLength?: number }
          | { type: 'files'; exts?: string[]; fileType?: 'file' | 'directory' | 'any'; match?: string; minLength?: number; maxLength?: number }
          | { type: 'img'; exts?: string[] }
          | { type: 'over'; label?: string; exclude?: string; minLength?: number; maxLength?: number }
        >
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
  console.log('[image_stitching] 插件已加载')
}

export function onUnload() {
  console.log('[image_stitching] 插件已卸载')
}

export function onEnable() {
  console.log('[image_stitching] 插件已启用')
}

export function onDisable() {
  console.log('[image_stitching] 插件已禁用')
}

export async function run(context: PluginContext) {
  const { notification, features } = context.api
  
  // 注册图片拼接功能
  if (features) {
    features.setFeature({
      code: 'image_stitching',
      explain: '长图拼接 - 将多张图片任意纵向裁切后拼接成一张长图',
      icon: '🖼️',
      mode: 'ui',
      route: '/stitch',
      mainHide: false,
      mainPush: true,
      cmds: [
        { type: 'keyword', value: '图片拼接', explain: '长图拼接功能' },
        { type: 'keyword', value: 'image stitch', explain: 'Image stitching function' },
        { type: 'img', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }
      ]
    })
  }
  
  notification.show('图片拼接插件已启动')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
