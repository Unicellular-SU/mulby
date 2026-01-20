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

// 常用正则表达式模式
const COMMON_REGEX_PATTERNS = [
  {
    name: '邮箱地址',
    pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
    description: '匹配常见的邮箱地址格式'
  },
  {
    name: 'URL地址',
    pattern: 'https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)',
    description: '匹配HTTP/HTTPS URL'
  },
  {
    name: '手机号码',
    pattern: '1[3-9]\\d{9}',
    description: '匹配中国大陆手机号码'
  },
  {
    name: '身份证号',
    pattern: '\\d{17}[\\dXx]|\\d{15}',
    description: '匹配18位或15位身份证号'
  },
  {
    name: 'IP地址',
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    description: '匹配IPv4地址'
  },
  {
    name: 'HTML标签',
    pattern: '<[^>]+>',
    description: '匹配HTML标签'
  },
  {
    name: '中文字符',
    pattern: '[\\u4e00-\\u9fff]',
    description: '匹配中文字符'
  },
  {
    name: '数字',
    pattern: '\\d+',
    description: '匹配一个或多个数字'
  },
  {
    name: '单词',
    pattern: '\\b\\w+\\b',
    description: '匹配单词'
  },
  {
    name: '空白行',
    pattern: '^\\s*$',
    description: '匹配空白行'
  }
]

export function onLoad() {
  console.log('[reg_helper] 正则表达式编辑器插件已加载')
}

export function onUnload() {
  console.log('[reg_helper] 正则表达式编辑器插件已卸载')
}

export function onEnable() {
  console.log('[reg_helper] 正则表达式编辑器插件已启用')
}

export function onDisable() {
  console.log('[reg_helper] 正则表达式编辑器插件已禁用')
}

// 验证正则表达式是否有效
function validateRegex(pattern: string, flags: string = ''): { valid: boolean; error?: string } {
  try {
    new RegExp(pattern, flags)
    return { valid: true }
  } catch (error: any) {
    return { valid: false, error: error.message }
  }
}

// 执行正则匹配
function executeRegex(pattern: string, text: string, flags: string = ''): {
  matches: Array<{ match: string; index: number; groups: string[] }>;
  valid: boolean;
  error?: string;
} {
  try {
    const regex = new RegExp(pattern, flags)
    const matches: Array<{ match: string; index: number; groups: string[] }> = []
    let match
    
    // 重置正则的lastIndex
    regex.lastIndex = 0
    
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        match: match[0],
        index: match.index,
        groups: match.slice(1)
      })
      
      // 如果非全局匹配，只匹配一次
      if (!flags.includes('g')) break
    }
    
    return { matches, valid: true }
  } catch (error: any) {
    return { matches: [], valid: false, error: error.message }
  }
}

export async function run(context: PluginContext) {
  const { notification, clipboard } = context.api
  const input = context.input || ''
  
  console.log('[reg_helper] 插件运行，输入:', input)
  
  // 如果输入是正则表达式，尝试验证
  if (input.trim().startsWith('/') && input.includes('/')) {
    const parts = input.split('/')
    if (parts.length >= 3) {
      const pattern = parts[1]
      const flags = parts[2] || ''
      const validation = validateRegex(pattern, flags)
      
      if (validation.valid) {
        notification.show('正则表达式有效')
      } else {
        notification.show(`正则表达式错误: ${validation.error}`)
      }
    }
  }
  
  // 显示欢迎消息
  notification.show('正则表达式编辑器已启动')
  
  // 如果有输入文本，自动复制到剪贴板以便在编辑器中测试
  if (input && !input.startsWith('/')) {
    await clipboard.writeText(input)
  }
}

// 导出工具函数供其他模块使用
export const regexUtils = {
  validateRegex,
  executeRegex,
  COMMON_REGEX_PATTERNS
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin