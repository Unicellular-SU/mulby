/**
 * InTools Showcase - Backend Entry
 * 
 * 这个文件展示了插件后端的生命周期钩子和基本结构。
 * 对于纯 UI 插件，后端主要用于初始化和资源管理。
 */

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
    storage: {
      get: (key: string) => Promise<unknown>
      set: (key: string, value: unknown) => Promise<void>
    }
    features: {
      getFeatures: (codes?: string[]) => Array<{ code: string }>
      setFeature: (feature: {
        code: string
        explain?: string
        icon?: string
        platform?: string | string[]
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

/**
 * 插件加载时调用
 * 用于初始化资源、注册服务等
 */
export function onLoad(context?: PluginContext) {
  console.log('[InTools Showcase] 插件已加载')

  const features = context?.api.features
  if (!features) return

  const existing = features.getFeatures()
  if (existing && existing.length > 0) return

  features.setFeature({
    code: 'showcase:today',
    explain: '动态指令：显示今日日期',
    cmds: ['today', '日期']
  })

  features.setFeature({
    code: 'showcase:reverse',
    explain: '动态指令：反转输入文本',
    cmds: [
      { type: 'keyword', value: 'reverse' },
      { type: 'regex', match: '^rev\\s+.+', explain: 'rev 开头文本' }
    ]
  })

  features.setFeature({
    code: 'showcase:mac-only',
    explain: '动态指令：仅 macOS 可见',
    platform: 'darwin',
    cmds: ['mac only', 'macos']
  })
}

/**
 * 插件卸载时调用
 * 用于清理资源、保存状态等
 */
export function onUnload() {
  console.log('[InTools Showcase] 插件即将卸载')
}

/**
 * 插件启用时调用
 * 用于恢复服务、重新注册等
 */
export function onEnable() {
  console.log('[InTools Showcase] 插件已启用')
}

/**
 * 插件禁用时调用
 * 用于暂停服务、释放资源等
 */
export function onDisable() {
  console.log('[InTools Showcase] 插件已禁用')
}

/**
 * 主执行函数
 * 当用户触发插件时调用
 * 
 * @param context - 执行上下文
 * @param context.api - InTools API 接口
 * @param context.input - 用户输入
 * @param context.feature - 触发的功能代码
 */
export async function run(context: PluginContext) {
  const { notification } = context.api

  // 记录功能触发
  console.log(`[InTools Showcase] 功能触发: ${context.featureCode || 'main'}`)

  // 对于 UI 插件，主要逻辑在前端处理
  // 这里可以做一些后端初始化工作

  // 示例：根据不同功能显示不同通知
  switch (context.featureCode) {
    case 'sysinfo':
      notification.show('正在加载系统信息...')
      break
    case 'clipboard':
      notification.show('剪贴板管理器已就绪')
      break
    case 'input':
      notification.show('输入控制已就绪')
      break
    case 'screenshot':
      notification.show('截图功能已就绪')
      break
    default:
      // 不显示通知，让 UI 自己处理
      break
  }
}

// 同时导出为 module.exports 以保持兼容性
const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
