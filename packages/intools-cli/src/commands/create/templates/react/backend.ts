/**
 * React 插件模板 - 后端代码生成器
 * 包含：src/main.ts
 */

/**
 * 生成后端 main.ts 内容
 */
export function buildBackendMain(name: string) {
    return `interface PluginContext {
  api: {
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
      readImage: () => ArrayBuffer | null
      getFormat: () => string
    }
    clipboardHistory: {
      query: (options?: {
        type?: 'text' | 'image' | 'files'
        search?: string
        favorite?: boolean
        limit?: number
        offset?: number
      }) => Promise<any[]>
      get: (id: string) => Promise<any>
      copy: (id: string) => Promise<{ success: boolean; error?: string }>
      toggleFavorite: (id: string) => Promise<{ success: boolean }>
      delete: (id: string) => Promise<{ success: boolean }>
      clear: () => Promise<{ success: boolean }>
      stats: () => Promise<{ total: number; text: number; image: number; files: number; favorite: number }>
    }
    notification: {
      show: (message: string, type?: string) => void
    }
    messaging: {
      send: (targetPluginId: string, type: string, payload: unknown) => Promise<void>
      broadcast: (type: string, payload: unknown) => Promise<void>
      on: (handler: (message: { id: string; from: string; to?: string; type: string; payload: unknown; timestamp: number }) => void | Promise<void>) => void
      off: (handler?: (message: any) => void) => void
    }
    scheduler: {
      schedule: (task: {
        name: string
        type: 'once' | 'repeat' | 'delay'
        callback: string
        time?: number
        cron?: string
        delay?: number
        payload?: any
        maxRetries?: number
        retryDelay?: number
        timeout?: number
      }) => Promise<any>
      cancelTask: (taskId: string) => Promise<void>
      pauseTask: (taskId: string) => Promise<void>
      resumeTask: (taskId: string) => Promise<void>
      listTasks: (filter?: { status?: string; type?: string; limit?: number; offset?: number }) => Promise<any[]>
      getTaskCount: (filter?: { status?: string; type?: string }) => Promise<number>
      getTask: (taskId: string) => Promise<any>
      deleteTasks: (taskIds: string[]) => Promise<{ success: boolean; deletedCount: number }>
      cleanupTasks: (olderThan?: number) => Promise<{ success: boolean; deletedCount: number }>
      getExecutions: (taskId: string, limit?: number) => Promise<any[]>
      validateCron: (expression: string) => boolean
      getNextCronTime: (expression: string, after?: Date) => Date
      describeCron: (expression: string) => string
    }
    ai: {
      call: (option: {
        model?: string
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content?: string | Array<any> }>
        tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: object } }>
        params?: any
      }, onChunk?: (chunk: any) => void) => Promise<{ role: 'assistant'; content?: string }>
      allModels: () => Promise<any[]>
      tokens: {
        estimate: (input: { model?: string; messages: Array<any> }) => Promise<{ inputTokens: number; outputTokens: number }>
      }
      attachments: {
        upload: (input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => Promise<any>
        get: (attachmentId: string) => Promise<any>
        delete: (attachmentId: string) => Promise<void>
      }
      images: {
        generate: (input: { model: string; prompt: string; size?: string; count?: number }) => Promise<{ images: string[] }>
        edit: (input: { model: string; imageAttachmentId: string; prompt: string }) => Promise<{ images: string[] }>
      }
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
  console.log('[${name}] 插件已加载')
}

export function onUnload() {
  console.log('[${name}] 插件已卸载')
}

export function onEnable() {
  console.log('[${name}] 插件已启用')
}

export function onDisable() {
  console.log('[${name}] 插件已禁用')
}

export async function run(context: PluginContext) {
  const { notification } = context.api
  notification.show('插件已启动')
}

// 导出 host 方法供 UI 调用
// 支持三种导出方式（按优先级）：
// 1. 直接导出函数: export async function myMethod(context, ...args) {}
// 2. host 对象（推荐）: export const host = { myMethod(context, ...args) {} }
// 3. 其他对象: export const api = { myMethod(context, ...args) {} }

export const host = {
  // 示例方法：处理数据
  async processData(context: PluginContext, data: any) {
    const { notification } = context.api
    notification.show('处理数据中...')

    // 处理逻辑
    const result = {
      ...data,
      processed: true,
      timestamp: Date.now()
    }

    return result
  },

  // 示例方法：获取配置
  async getConfig(context: PluginContext) {
    // 可以使用 context.api 中的所有 API
    return {
      version: '1.0.0',
      settings: {}
    }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, host }
export default plugin
`
}
