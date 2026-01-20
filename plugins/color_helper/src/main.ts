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
  console.log('[color_helper] 颜色助手插件已加载')
}

export function onUnload() {
  console.log('[color_helper] 颜色助手插件已卸载')
}

export function onEnable() {
  console.log('[color_helper] 颜色助手插件已启用')
}

export function onDisable() {
  console.log('[color_helper] 颜色助手插件已禁用')
}

export async function run(context: PluginContext) {
  const { notification, features } = context.api
  
  // 注册插件功能
  if (features) {
    // 颜色解析功能
    features.setFeature({
      code: 'color_parser',
      explain: '颜色值解析工具 - 支持HEX、RGB格式',
      icon: '🎨',
      mode: 'ui',
      route: '/color',
      cmds: [
        {
          type: 'keyword',
          value: 'color',
          explain: '打开颜色解析工具'
        },
        {
          type: 'regex',
          match: '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$',
          explain: '解析HEX颜色值',
          label: '解析HEX颜色'
        },
        {
          type: 'regex',
          match: '^rgb\\(\\d+,\\s*\\d+,\\s*\\d+\\)$',
          explain: '解析RGB颜色值',
          label: '解析RGB颜色'
        }
      ]
    })

    // 图片色卡功能
    features.setFeature({
      code: 'image_colors',
      explain: '从图片提取颜色色卡',
      icon: '🖼️',
      mode: 'ui',
      route: '/image',
      cmds: [
        {
          type: 'keyword',
          value: 'image colors',
          explain: '打开图片色卡提取工具'
        },
        {
          type: 'img',
          exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
          explain: '从图片提取颜色'
        }
      ]
    })

    // UI色卡功能
    features.setFeature({
      code: 'ui_colors',
      explain: '常用UI设计色卡',
      icon: '🎯',
      mode: 'ui',
      route: '/ui',
      cmds: [
        {
          type: 'keyword',
          value: 'ui colors',
          explain: '查看UI设计色卡'
        }
      ]
    })

    // 传统色功能
    features.setFeature({
      code: 'traditional_colors',
      explain: '中国传统颜色库',
      icon: '🏮',
      mode: 'ui',
      route: '/traditional',
      cmds: [
        {
          type: 'keyword',
          value: 'traditional colors',
          explain: '查看中国传统颜色'
        }
      ]
    })

    // 渐变色功能
    features.setFeature({
      code: 'gradients',
      explain: '渐变色生成器',
      icon: '🌈',
      mode: 'ui',
      route: '/gradient',
      cmds: [
        {
          type: 'keyword',
          value: 'gradient',
          explain: '打开渐变色生成器'
        }
      ]
    })

    // 收藏功能
    features.setFeature({
      code: 'color_favorites',
      explain: '收藏的颜色和渐变色',
      icon: '⭐',
      mode: 'ui',
      route: '/favorites',
      cmds: [
        {
          type: 'keyword',
          value: 'color favorites',
          explain: '查看收藏的颜色'
        }
      ]
    })
  }
  
  notification.show('颜色助手已启动')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin