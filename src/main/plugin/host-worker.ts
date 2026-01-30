/**
 * Plugin Host Worker
 * 运行在 UtilityProcess 中，负责执行插件代码
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { VM } from 'vm2'
import type {
  HostRequest,
  HostResponse,
  ApiResult,
  InitRequest,
  RunRequest,
  CallHookRequest
} from './host-protocol'

// ============ 状态 ============

interface PluginState {
  pluginName: string
  pluginPath: string
  mainFile: string
  vm: VM | null
  module: PluginModule | null
}

interface PluginModule {
  run?: (context: PluginContext) => void | Promise<void>
  onLoad?: (context?: HookContext) => void | Promise<void>
  onUnload?: (context?: HookContext) => void | Promise<void>
  onEnable?: (context?: HookContext) => void | Promise<void>
  onDisable?: (context?: HookContext) => void | Promise<void>
  onBackground?: (context?: HookContext) => void | Promise<void>
  onForeground?: (context?: HookContext) => void | Promise<void>
}

interface PluginContext {
  api: PluginAPI
  featureCode: string
  input: string
  attachments?: InputAttachment[]
}

interface HookContext {
  api: PluginAPI
}

type PluginAPI = Record<string, unknown>

interface InputAttachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'image'
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
}

let pluginState: PluginState | null = null
const pendingApiCalls = new Map<string, {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}>()

// ============ 消息处理 ============

/** 发送消息到主进程 */
function send(message: HostResponse): void {
  process.parentPort?.postMessage(message)
}

/** 生成请求 ID */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/** 调用主进程 API */
async function callMainApi(api: string, args: unknown[]): Promise<unknown> {
  const id = generateId()
  const sanitizedArgs = args.map(cloneForMessage)

  return new Promise((resolve, reject) => {
    pendingApiCalls.set(id, { resolve, reject })

    send({
      id,
      type: 'apiCall',
      payload: { api, args: sanitizedArgs }
    })

    // 30 秒超时
    setTimeout(() => {
      if (pendingApiCalls.has(id)) {
        pendingApiCalls.delete(id)
        reject(new Error(`API call timeout: ${api}`))
      }
    }, 30000)
  })
}

function cloneForMessage<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T
    } catch {
      return null as T
    }
  }
}

/** 创建代理 API 对象 */
function createProxyAPI(): PluginAPI {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (typeof prop !== 'string') return undefined

      // 返回一个代理对象，用于处理嵌套属性访问
      return new Proxy({}, {
        get(_, method: string) {
          if (typeof method !== 'string') return undefined

          // 返回一个函数，调用时转发到主进程
          return (...args: unknown[]) => {
            return callMainApi(`${prop}.${method}`, args)
          }
        }
      })
    }
  }

  return new Proxy({}, handler)
}

// ============ 插件执行 ============

/** 初始化插件 */
function handleInit(request: InitRequest): void {
  const { pluginName, pluginPath, mainFile } = request.payload

  try {
    pluginState = {
      pluginName,
      pluginPath,
      mainFile,
      vm: null,
      module: null
    }

    send({
      id: request.id,
      type: 'result',
      payload: { success: true }
    })
  } catch (err) {
    send({
      id: request.id,
      type: 'error',
      payload: {
        message: err instanceof Error ? err.message : 'Init failed',
        stack: err instanceof Error ? err.stack : undefined
      }
    })
  }
}

/** 加载插件模块 */
function loadModule(): PluginModule {
  if (!pluginState) {
    throw new Error('Plugin not initialized')
  }

  if (pluginState.module) {
    return pluginState.module
  }

  const mainPath = join(pluginState.pluginPath, pluginState.mainFile)
  const code = readFileSync(mainPath, 'utf-8')

  pluginState.vm = new VM({
    timeout: 5000,
    sandbox: {
      module: { exports: {} },
      exports: {},
      require: () => null,
      console,
      Buffer,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      setImmediate,
      clearImmediate
    }
  })

  pluginState.module = pluginState.vm.run(code + '\nmodule.exports') as PluginModule
  return pluginState.module
}

/** 执行插件 */
async function handleRun(request: RunRequest): Promise<void> {
  const { featureCode, input, attachments } = request.payload

  try {
    const module = loadModule()
    const api = createProxyAPI()
    const context: PluginContext = { api, featureCode, input, attachments }

    if (typeof module.run === 'function') {
      await module.run(context)
    }

    send({
      id: request.id,
      type: 'result',
      payload: { success: true }
    })
  } catch (err) {
    send({
      id: request.id,
      type: 'error',
      payload: {
        message: err instanceof Error ? err.message : 'Run failed',
        stack: err instanceof Error ? err.stack : undefined
      }
    })
  }
}

/** 调用生命周期钩子 */
async function handleCallHook(request: CallHookRequest): Promise<void> {
  const { hookName } = request.payload

  try {
    const module = loadModule()
    const hook = module[hookName]

    if (typeof hook === 'function') {
      const api = createProxyAPI()
      await hook({ api })
    }

    send({
      id: request.id,
      type: 'result',
      payload: { success: true }
    })
  } catch (err) {
    send({
      id: request.id,
      type: 'error',
      payload: {
        message: err instanceof Error ? err.message : 'Hook failed',
        stack: err instanceof Error ? err.stack : undefined
      }
    })
  }
}

/** 调用任务回调 */
async function handleCallTaskCallback(request: any): Promise<void> {
  const { callbackName, payload, task } = request.payload

  try {
    const module = loadModule()
    const callback = (module as any)[callbackName]

    if (typeof callback === 'function') {
      const api = createProxyAPI()
      const result = await callback({ api, payload, task })

      // 序列化结果以确保可以通过 postMessage 发送
      const serializedResult = cloneForMessage(result)

      send({
        id: request.id,
        type: 'result',
        payload: { success: true, data: serializedResult }
      })
    } else {
      throw new Error(`Callback not found: ${callbackName}`)
    }
  } catch (err) {
    send({
      id: request.id,
      type: 'error',
      payload: {
        message: err instanceof Error ? err.message : 'Callback failed',
        stack: err instanceof Error ? err.stack : undefined
      }
    })
  }
}

/** 调用 host 方法 */
async function handleCallHostMethod(request: any): Promise<void> {
  const { method, args } = request.payload

  try {
    const module = loadModule() as any

    // 检查是否有 host 对象
    if (!module.host || typeof module.host !== 'object') {
      throw new Error('Plugin does not export a host object')
    }

    // 获取 host 方法
    const hostMethod = module.host[method]
    if (typeof hostMethod !== 'function') {
      throw new Error(`Host method not found: ${method}`)
    }

    // 调用 host 方法，传入 context 和其他参数
    const api = createProxyAPI()
    const context = { api }
    const result = await hostMethod(context, ...args)

    // 序列化结果
    const serializedResult = cloneForMessage(result)

    send({
      id: request.id,
      type: 'result',
      payload: { success: true, data: serializedResult }
    })
  } catch (err) {
    send({
      id: request.id,
      type: 'error',
      payload: {
        message: err instanceof Error ? err.message : 'Host method call failed',
        stack: err instanceof Error ? err.stack : undefined
      }
    })
  }
}

/** 处理 API 调用结果 */
function handleApiResult(result: ApiResult): void {
  const pending = pendingApiCalls.get(result.id)
  if (!pending) return

  pendingApiCalls.delete(result.id)

  if (result.success) {
    pending.resolve(result.data)
  } else {
    pending.reject(new Error(result.error || 'API call failed'))
  }
}

// ============ 主入口 ============

/** 处理来自主进程的消息 */
function handleMessage(message: HostRequest | ApiResult): void {
  // 检查是否是 API 结果
  if ('success' in message) {
    handleApiResult(message as ApiResult)
    return
  }

  const request = message as HostRequest

  switch (request.type) {
    case 'init':
      handleInit(request)
      break
    case 'run':
      handleRun(request)
      break
    case 'callHook':
      handleCallHook(request)
      break
    case 'callTaskCallback':
      handleCallTaskCallback(request)
      break
    case 'callHostMethod':
      handleCallHostMethod(request)
      break
    case 'terminate':
      process.exit(0)
      break
  }
}

// 监听主进程消息
process.parentPort?.on('message', (event) => {
  handleMessage(event.data)
})

// 发送就绪信号
send({
  id: generateId(),
  type: 'ready',
  payload: null
})

// 启动心跳机制（每 3 秒发送一次心跳）
setInterval(() => {
  send({
    id: generateId(),
    type: 'result',
    payload: { success: true, heartbeat: true }
  })
}, 3000)

// 启动资源统计收集（每 5 秒发送一次）
setInterval(() => {
  const memoryUsage = process.memoryUsage()
  const cpuUsage = process.cpuUsage()

  send({
    id: generateId(),
    type: 'resourceStats',
    payload: {
      memoryUsage: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system
      }
    }
  })
}, 5000)
