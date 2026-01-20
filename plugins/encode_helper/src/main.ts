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
  console.log('[encode_helper] 插件已加载')
}

export function onUnload() {
  console.log('[encode_helper] 插件已卸载')
}

export function onEnable() {
  console.log('[encode_helper] 插件已启用')
}

export function onDisable() {
  console.log('[encode_helper] 插件已禁用')
}

export async function run(context: PluginContext) {
  const { notification, features } = context.api
  
  // 注册所有功能
  if (features) {
    // 时间转换功能
    features.setFeature({
      code: 'time_convert',
      explain: '时间戳与日期时间相互转换',
      icon: '⏰',
      mode: 'ui',
      route: '/time',
      cmds: [
        { type: 'keyword', value: '时间转换', explain: '时间戳与日期时间转换' },
        { type: 'keyword', value: 'timestamp', explain: '时间戳转换' },
        { type: 'regex', match: '^\\d{10,13}$', explain: '时间戳转换', label: '时间戳' }
      ]
    })

    // Base64编解码功能
    features.setFeature({
      code: 'base64',
      explain: 'Base64编码与解码',
      icon: '🔢',
      mode: 'ui',
      route: '/base64',
      cmds: [
        { type: 'keyword', value: 'base64', explain: 'Base64编解码' },
        { type: 'keyword', value: 'base64编码', explain: 'Base64编码' },
        { type: 'keyword', value: 'base64解码', explain: 'Base64解码' }
      ]
    })

    // URL编解码功能
    features.setFeature({
      code: 'url',
      explain: 'URL编码与解码',
      icon: '🔗',
      mode: 'ui',
      route: '/url',
      cmds: [
        { type: 'keyword', value: 'url编码', explain: 'URL编码' },
        { type: 'keyword', value: 'url解码', explain: 'URL解码' },
        { type: 'keyword', value: 'urlencode', explain: 'URL编码' },
        { type: 'keyword', value: 'urldecode', explain: 'URL解码' }
      ]
    })

    // 哈希加密功能
    features.setFeature({
      code: 'hash',
      explain: '哈希加密（MD5、SHA1、SHA256等）',
      icon: '🔐',
      mode: 'ui',
      route: '/hash',
      cmds: [
        { type: 'keyword', value: '哈希', explain: '哈希加密' },
        { type: 'keyword', value: 'md5', explain: 'MD5加密' },
        { type: 'keyword', value: 'sha1', explain: 'SHA1加密' },
        { type: 'keyword', value: 'sha256', explain: 'SHA256加密' }
      ]
    })

    // Unicode转换功能
    features.setFeature({
      code: 'unicode',
      explain: 'Unicode编码与解码',
      icon: '🔤',
      mode: 'ui',
      route: '/unicode',
      cmds: [
        { type: 'keyword', value: 'unicode', explain: 'Unicode转换' },
        { type: 'keyword', value: 'unicode编码', explain: 'Unicode编码' },
        { type: 'keyword', value: 'unicode解码', explain: 'Unicode解码' }
      ]
    })

    // UUID生成功能
    features.setFeature({
      code: 'uuid',
      explain: '生成UUID',
      icon: '🆔',
      mode: 'ui',
      route: '/uuid',
      cmds: [
        { type: 'keyword', value: 'uuid', explain: '生成UUID' },
        { type: 'keyword', value: '生成uuid', explain: '生成UUID' },
        { type: 'keyword', value: 'guid', explain: '生成GUID' }
      ]
    })

    // 进制转换功能
    features.setFeature({
      code: 'radix',
      explain: '进制转换（二进制、八进制、十进制、十六进制）',
      icon: '🔢',
      mode: 'ui',
      route: '/radix',
      cmds: [
        { type: 'keyword', value: '进制转换', explain: '进制转换' },
        { type: 'keyword', value: '二进制', explain: '二进制转换' },
        { type: 'keyword', value: '十六进制', explain: '十六进制转换' },
        { type: 'regex', match: '^[01]+$', explain: '二进制转换', label: '二进制' },
        { type: 'regex', match: '^[0-9A-Fa-f]+$', explain: '十六进制转换', label: '十六进制' }
      ]
    })

    // HTML转义功能
    features.setFeature({
      code: 'html',
      explain: 'HTML实体编码与解码',
      icon: '📄',
      mode: 'ui',
      route: '/html',
      cmds: [
        { type: 'keyword', value: 'html转义', explain: 'HTML转义' },
        { type: 'keyword', value: 'html编码', explain: 'HTML编码' },
        { type: 'keyword', value: 'html解码', explain: 'HTML解码' }
      ]
    })
  }
  
  notification.show('编码小助手已启动')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin