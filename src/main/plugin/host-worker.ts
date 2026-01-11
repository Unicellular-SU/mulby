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
  onLoad?: () => void | Promise<void>
  onUnload?: () => void | Promise<void>
  onEnable?: () => void | Promise<void>
  onDisable?: () => void | Promise<void>
}

interface PluginContext {
  api: PluginAPI
  featureCode: string
  input: string
}

type PluginAPI = Record<string, unknown>

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

  return new Promise((resolve, reject) => {
    pendingApiCalls.set(id, { resolve, reject })

    send({
      id,
      type: 'apiCall',
      payload: { api, args }
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
      Buffer
    }
  })

  pluginState.module = pluginState.vm.run(code + '\nmodule.exports') as PluginModule
  return pluginState.module
}

/** 执行插件 */
async function handleRun(request: RunRequest): Promise<void> {
  const { featureCode, input } = request.payload

  try {
    const module = loadModule()
    const api = createProxyAPI()
    const context: PluginContext = { api, featureCode, input }

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
      await hook()
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
