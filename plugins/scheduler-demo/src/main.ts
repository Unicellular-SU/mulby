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
      cancel: (taskId: string) => Promise<void>
      pause: (taskId: string) => Promise<void>
      resume: (taskId: string) => Promise<void>
      list: (filter?: { status?: string; type?: string }) => Promise<any[]>
      get: (taskId: string) => Promise<any>
      getExecutions: (taskId: string, limit?: number) => Promise<any[]>
      validateCron: (expression: string) => boolean
      getNextCronTime: (expression: string, after?: Date) => Date
      describeCron: (expression: string) => string
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

// 后台任务状态
let taskCount = 0

export function onLoad() {
  console.log('[scheduler-demo] 插件已加载')
}

export function onUnload() {
  console.log('[scheduler-demo] 插件已卸载')
}

export function onEnable() {
  console.log('[scheduler-demo] 插件已启用')
}

export function onDisable() {
  console.log('[scheduler-demo] 插件已禁用')
}

// 后台任务启动
export async function onBackground(context: PluginContext) {
  const { notification } = context.api

  console.log('[scheduler-demo] 后台任务启动')
  notification.show('后台任务已启动')

  // 注意：不在这里自动创建任务
  // 任务应该由用户通过 UI 手动创建
  // 这样用户可以完全控制任务的创建和管理
}

// 后台任务停止时清理
export async function onBackgroundStop(context: PluginContext) {
  const { notification } = context.api

  console.log('[scheduler-demo] 后台任务停止')
  notification.show('后台任务已停止')
}

// 定时任务回调
export async function onScheduledTask(context: PluginContext & { payload: any; task: any }) {
  const { notification } = context.api
  const { payload } = context

  taskCount++
  console.log(`[scheduler-demo] 定时任务执行 #${taskCount}:`, payload.message)

  notification.show(`定时任务 #${taskCount}: ${payload.message}`)

  return { success: true, count: taskCount }
}

// 一次性任务回调
export async function onOnceTask(context: PluginContext & { payload: any }) {
  const { notification } = context.api
  const { payload } = context

  console.log('[scheduler-demo] 一次性任务执行:', payload)
  notification.show(`一次性任务: ${payload.message}`)

  return { success: true, executedAt: new Date().toISOString() }
}

// 延迟任务回调
export async function onDelayTask(context: PluginContext & { payload: any }) {
  const { notification } = context.api
  const { payload } = context

  console.log('[scheduler-demo] 延迟任务执行:', payload)
  notification.show(`延迟任务: ${payload.message}`)

  return { success: true, executedAt: new Date().toISOString() }
}

// 主功能：打开任务管理界面
export async function run(context: PluginContext) {
  const { notification } = context.api
  notification.show('任务调度演示插件')
}

// 方式1：直接导出函数（最简单）
export async function directMethod(context: PluginContext, message: string) {
  const { notification } = context.api
  console.log('[scheduler-demo] directMethod called:', message)
  notification.show(`直接导出方法: ${message}`)

  return {
    success: true,
    message: `Direct export: ${message}`,
    timestamp: new Date().toISOString()
  }
}

// 方式2：导出 host 对象（推荐，语义清晰）
export const host = {
  // 测试方法：返回当前时间和插件信息
  async testMethod(context: PluginContext, message: string) {
    const { notification } = context.api
    const timestamp = new Date().toISOString()

    console.log('[scheduler-demo] testMethod called with message:', message)
    notification.show(`Host方法被调用: ${message}`)

    return {
      success: true,
      message: `Hello from host! You said: ${message}`,
      timestamp,
      pluginName: 'scheduler-demo'
    }
  },

  // 获取所有任务
  async getTasks(context: PluginContext) {
    const { scheduler } = context.api
    return await scheduler.list()
  },

  // 获取任务执行历史
  async getTaskExecutions(context: PluginContext, taskId: string) {
    const { scheduler } = context.api
    return await scheduler.getExecutions(taskId, 10)
  },

  // 创建一次性任务
  async createOnceTask(context: PluginContext, delay: number, message: string) {
    const { scheduler } = context.api
    return await scheduler.schedule({
      name: '一次性任务',
      type: 'once',
      time: Date.now() + delay,
      callback: 'onOnceTask',
      payload: { message }
    })
  },

  // 创建延迟任务
  async createDelayTask(context: PluginContext, delay: number, message: string) {
    const { scheduler } = context.api
    return await scheduler.schedule({
      name: '延迟任务',
      type: 'delay',
      delay: delay,
      callback: 'onDelayTask',
      payload: { message }
    })
  },

  // 创建重复任务
  async createRepeatTask(context: PluginContext, cron: string, message: string) {
    const { scheduler } = context.api

    // 验证 cron 表达式
    if (!scheduler.validateCron(cron)) {
      throw new Error('无效的 Cron 表达式')
    }

    return await scheduler.schedule({
      name: '重复任务',
      type: 'repeat',
      cron: cron,
      callback: 'onScheduledTask',
      payload: { message }
    })
  },

  // 取消任务
  async cancelTask(context: PluginContext, taskId: string) {
    const { scheduler } = context.api
    await scheduler.cancel(taskId)
  },

  // 暂停任务
  async pauseTask(context: PluginContext, taskId: string) {
    const { scheduler } = context.api
    await scheduler.pause(taskId)
  },

  // 恢复任务
  async resumeTask(context: PluginContext, taskId: string) {
    const { scheduler } = context.api
    await scheduler.resume(taskId)
  },

  // 验证 Cron 表达式
  validateCron(context: PluginContext, expression: string) {
    const { scheduler } = context.api
    return scheduler.validateCron(expression)
  },

  // 描述 Cron 表达式
  describeCron(context: PluginContext, expression: string) {
    const { scheduler } = context.api
    return scheduler.describeCron(expression)
  },

  // 获取下次执行时间
  getNextCronTime(context: PluginContext, expression: string) {
    const { scheduler } = context.api
    return scheduler.getNextCronTime(expression)
  }
}

// 方式3：导出 api 对象（也支持）
export const api = {
  async customMethod(context: PluginContext, data: any) {
    const { notification } = context.api
    console.log('[scheduler-demo] customMethod called:', data)
    notification.show(`API方法: ${JSON.stringify(data)}`)

    return {
      success: true,
      received: data,
      processedAt: new Date().toISOString()
    }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, onBackground, onBackgroundStop, onScheduledTask, onOnceTask, onDelayTask, host, api, directMethod }
export default plugin
