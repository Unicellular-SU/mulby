interface PluginContext {
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
        generateStream: (
          input: { model: string; prompt: string; size?: string; count?: number },
          onChunk: (chunk: {
            type: 'status' | 'preview'
            stage?: 'start' | 'partial' | 'finalizing' | 'completed' | 'fallback'
            message?: string
            image?: string
            index?: number
            received?: number
            total?: number
          }) => void
        ) => Promise<{ images: string[] }>
        edit: (input: { model: string; imageAttachmentId: string; prompt: string }) => Promise<{ images: string[] }>
      }
    }
    system: {
      getSystemInfo: () => Promise<any>
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

type ToolInput = { a: number; b: number }

type ToolCallPayload = {
  model?: string
  prompt: string
}

export function onLoad() {
  console.log('[ai-api-test] 插件已加载')
}

export function onUnload() {
  console.log('[ai-api-test] 插件已卸载')
}

export function onEnable() {
  console.log('[ai-api-test] 插件已启用')
}

export function onDisable() {
  console.log('[ai-api-test] 插件已禁用')
}

export async function run(context: PluginContext) {
  const { notification } = context.api
  notification.show('AI API 测试插件已启动')
}

export const host = {
  async sumNumbers(_context: PluginContext, input: ToolInput) {
    console.log('[ai-api-test] sumNumbers 被调用', { input })
    const a = Number(input?.a ?? 0)
    const b = Number(input?.b ?? 0)
    const result = { result: a + b }
    console.log('[ai-api-test] sumNumbers 返回', result)
    return result
  },

  async getSystemInfo(context: PluginContext) {
    console.log('[ai-api-test] getSystemInfo 被调用')
    try {
      // 使用 context.api.system.getSystemInfo() 而不是直接 require('node:os')
      const systemInfo = await context.api.system.getSystemInfo()
      console.log('[ai-api-test] getSystemInfo 返回', systemInfo)
      return systemInfo
    } catch (error) {
      console.error('[ai-api-test] getSystemInfo 错误', error)
      throw error
    }
  },

  async runToolCall(context: PluginContext, payload: ToolCallPayload) {
    console.log('[ai-api-test] runToolCall 开始', { model: payload.model, prompt: payload.prompt })

    const tools: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: object } }> = [
      {
        type: 'function',
        function: {
          name: 'sumNumbers',
          description: '计算两数之和',
          parameters: {
            type: 'object',
            properties: {
              a: { type: 'number', description: '第一个数字' },
              b: { type: 'number', description: '第二个数字' }
            },
            required: ['a', 'b']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'getSystemInfo',
          description: '获取系统信息',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      }
    ]

    console.log('[ai-api-test] 工具定义', tools)

    const result = await context.api.ai.call({
      model: payload.model,
      messages: [
        { role: 'system', content: '你是一个工具调用测试助手。' },
        { role: 'user', content: payload.prompt }
      ],
      tools,
      maxToolSteps: 20  // 设置最大工具调用步骤数为 20
    } as any)

    console.log('[ai-api-test] AI 调用结果', result)
    return result
  },

  async runToolCallStream(context: PluginContext, payload: ToolCallPayload, onChunk: (chunk: any) => void) {
    console.log('[ai-api-test] runToolCallStream 开始', { model: payload.model, prompt: payload.prompt })

    const tools: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: object } }> = [
      {
        type: 'function',
        function: {
          name: 'sumNumbers',
          description: '计算两数之和',
          parameters: {
            type: 'object',
            properties: {
              a: { type: 'number', description: '第一个数字' },
              b: { type: 'number', description: '第二个数字' }
            },
            required: ['a', 'b']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'getSystemInfo',
          description: '获取系统信息',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      }
    ]

    console.log('[ai-api-test] 工具定义', tools)

    const result = await context.api.ai.call({
      model: payload.model,
      messages: [
        { role: 'system', content: '你是一个工具调用测试助手。' },
        { role: 'user', content: payload.prompt }
      ],
      tools,
      maxToolSteps: 20  // 设置最大工具调用步骤数为 20
    } as any, onChunk)

    console.log('[ai-api-test] AI 调用结果', result)
    return result
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, host }
export default plugin
