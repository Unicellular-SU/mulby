/**
 * Plugin Host Worker
 * 运行在 UtilityProcess 中，负责执行插件代码
 * 
 * 安全模型：
 * - 进程级隔离由 UtilityProcess 提供
 * - API 权限由 createProxyAPI 白名单控制
 * - 资源限制由 watchdog 监控
 */

import { join, dirname } from 'path'
import { readFileSync } from 'fs'
import type {
  HostRequest,
  HostResponse,
  ApiResult,
  InitRequest,
  RunRequest,
  CallHookRequest,
  CallTaskCallbackRequest,
  CallHostMethodRequest
} from './host-protocol'

// ============ 状态 ============

interface PluginState {
  pluginName: string
  pluginPath: string
  mainFile: string
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
type HostMethod = (context: HookContext, ...args: unknown[]) => unknown | Promise<unknown>

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

// Plugin Tool Handlers 注册表
// 插件通过 mulby.tools.register(name, handler) 注册，AI 通过 __plugin_tool__{name} 调用
const pluginToolHandlers = new Map<string, (args: unknown) => unknown | Promise<unknown>>()

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

      // 特殊处理 tools 命名空间：register/unregister 直接在 worker 内处理
      if (prop === 'tools') {
        return {
          register: (name: string, toolHandler: (args: unknown) => unknown | Promise<unknown>) => {
            if (typeof name !== 'string' || !name.trim()) {
              throw new Error('Tool name must be a non-empty string')
            }
            if (typeof toolHandler !== 'function') {
              throw new Error('Tool handler must be a function')
            }
            pluginToolHandlers.set(name.trim(), toolHandler)
          },
          unregister: (name: string) => {
            pluginToolHandlers.delete(String(name || '').trim())
          }
        }
      }

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

/** 检测代码是否使用 ES Module 语法 */
function isESModule(code: string): boolean {
  // 检测 export 语句（排除注释和字符串中的）
  // 简单检测：以 export 开头的行，或 export { 或 export default
  const lines = code.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // 跳过注释
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue
    }
    // 检测 export 语句
    if (/^export\s+/.test(trimmed) || /^export\{/.test(trimmed)) {
      return true
    }
    // 检测顶层 import 语句（不是动态 import()）
    if (/^import\s+/.test(trimmed) && !trimmed.includes('import(')) {
      return true
    }
  }
  return false
}

/** 加载插件模块（支持 CommonJS 和 ES Module） */
async function loadModule(): Promise<PluginModule> {
  if (!pluginState) {
    throw new Error('Plugin not initialized')
  }

  if (pluginState.module) {
    return pluginState.module
  }

  const mainPath = join(pluginState.pluginPath, pluginState.mainFile)
  const code = readFileSync(mainPath, 'utf-8')

  // 检测模块格式
  if (isESModule(code)) {
    // ES Module 格式：使用动态 import()
    const cacheBuster = `?t=${Date.now()}`
    const module = await import(`file://${mainPath}${cacheBuster}`)
    pluginState.module = module.default || module
  } else {
    // CommonJS 格式：使用 Function 执行
    const moduleObj = { exports: {} as Record<string, unknown> }
    const exportsObj = moduleObj.exports

    const wrapper = new Function(
      'module', 'exports', 'require', '__filename', '__dirname',
      'console', 'Buffer', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'setImmediate', 'clearImmediate', 'process',
      code
    )

    wrapper(
      moduleObj, exportsObj, require, mainPath, dirname(mainPath),
      console, Buffer, setTimeout, setInterval, clearTimeout, clearInterval,
      setImmediate, clearImmediate, process
    )

    pluginState.module = (moduleObj.exports.default || moduleObj.exports) as PluginModule
  }

  return pluginState.module!
}

/** 执行插件 */
async function handleRun(request: RunRequest): Promise<void> {
  const { featureCode, input, attachments } = request.payload

  try {
    const module = await loadModule()
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
    const module = await loadModule()
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
async function handleCallTaskCallback(request: CallTaskCallbackRequest): Promise<void> {
  const { callbackName, payload, task } = request.payload

  try {
    const module = await loadModule()
    const callback = (module as Record<string, unknown>)[callbackName]

    if (typeof callback === 'function') {
      const api = createProxyAPI()
      const result = await (callback as HostMethod)({ api }, payload, task)

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
async function handleCallHostMethod(request: CallHostMethodRequest): Promise<void> {
  const { method, args } = request.payload

  try {
    // Plugin Tool 路由：__plugin_tool__{toolName} 格式直接查找已注册的 handler
    const PLUGIN_TOOL_PREFIX = '__plugin_tool__'
    if (method.startsWith(PLUGIN_TOOL_PREFIX)) {
      const toolName = method.slice(PLUGIN_TOOL_PREFIX.length)
      const handler = pluginToolHandlers.get(toolName)
      if (!handler) {
        throw new Error(
          `Plugin tool handler not registered: "${toolName}"\n` +
          `Please call mulby.tools.register("${toolName}", handler) before AI can invoke this tool.\n` +
          `Registered tools: ${pluginToolHandlers.size > 0 ? Array.from(pluginToolHandlers.keys()).join(', ') : 'none'}`
        )
      }
      const toolArgs = Array.isArray(args) ? args[0] : args
      const result = await handler(toolArgs)
      const serializedResult = cloneForMessage(result)

      send({
        id: request.id,
        type: 'result',
        payload: { success: true, data: serializedResult }
      })
      return
    }

    const module = (await loadModule()) as Record<string, unknown>

    // 方案1：按优先级查找方法
    let targetMethod: HostMethod | undefined

    // 1. 首先检查是否直接导出了该方法名的函数
    if (typeof module[method] === 'function') {
      targetMethod = module[method] as HostMethod
    }
    // 2. 检查 host 对象（约定的默认导出对象）
    else if (module.host && typeof module.host === 'object' && typeof (module.host as Record<string, unknown>)[method] === 'function') {
      targetMethod = (module.host as Record<string, unknown>)[method] as HostMethod
    }
    // 3. 检查其他可能的导出对象（api, methods, exports 等常见名称）
    else {
      const commonNames = ['api', 'methods', 'exports', 'handlers']
      for (const name of commonNames) {
        if (module[name] && typeof module[name] === 'object' && typeof (module[name] as Record<string, unknown>)[method] === 'function') {
          targetMethod = (module[name] as Record<string, unknown>)[method] as HostMethod
          break
        }
      }
    }

    // 如果找不到方法，抛出详细的错误信息
    if (!targetMethod) {
      const availableMethods: string[] = []

      // 收集所有可用的方法名
      Object.keys(module).forEach(key => {
        if (typeof module[key] === 'function' && !['run', 'onLoad', 'onUnload', 'onEnable', 'onDisable', 'onBackground', 'onForeground'].includes(key)) {
          availableMethods.push(key)
        } else if (module[key] && typeof module[key] === 'object') {
          const nestedModule = module[key] as Record<string, unknown>
          Object.keys(nestedModule).forEach(subKey => {
            if (typeof nestedModule[subKey] === 'function') {
              availableMethods.push(`${key}.${subKey}`)
            }
          })
        }
      })

      throw new Error(
        `Host method not found: ${method}\n` +
        `Available methods: ${availableMethods.length > 0 ? availableMethods.join(', ') : 'none'}\n` +
        `Tip: Export methods directly (export function ${method}), or in a 'host' object (export const host = { ${method} })`
      )
    }

    // 调用方法，传入 context 和其他参数
    const api = createProxyAPI()
    const context = { api }
    const result = await targetMethod(context, ...(Array.isArray(args) ? args : []))

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
