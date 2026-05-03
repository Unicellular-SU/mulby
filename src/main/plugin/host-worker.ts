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
import type { PluginToolCallContext, PluginToolProgress } from '../../shared/types/plugin'
import log from 'electron-log'

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
  onIdleLoad?: (context?: HookContext) => void | Promise<void>
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
type HostCallable = (...args: unknown[]) => unknown | Promise<unknown>

interface NodeModuleInstance {
  filename: string
  paths: string[]
  exports: unknown
  _compile(code: string, filename: string): void
}

interface NodeModuleConstructor {
  new (id: string): NodeModuleInstance
  _nodeModulePaths(from: string): string[]
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

let pluginState: PluginState | null = null
const pendingApiCalls = new Map<string, {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}>()

// Plugin Tool Handlers 注册表
// 插件通过 mulby.tools.register(name, handler) 注册，AI 通过 __plugin_tool__{name} 调用
const pluginToolHandlers = new Map<string, (args: unknown, ctx?: PluginToolCallContext) => unknown | Promise<unknown>>()

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

    // 5 分钟超时（适配 AI 长调用）
    setTimeout(() => {
      if (pendingApiCalls.has(id)) {
        pendingApiCalls.delete(id)
        reject(new Error(`API call timeout: ${api}`))
      }
    }, 300000)
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

function normalizeToolProgress(input: PluginToolProgress): PluginToolProgress | null {
  if (!input || typeof input !== 'object') return null
  const progress = Number((input as PluginToolProgress).progress)
  if (!Number.isFinite(progress)) return null

  const normalized: PluginToolProgress = { progress }
  const total = Number((input as PluginToolProgress).total)
  if (Number.isFinite(total) && total > 0) {
    normalized.total = total
  }

  if ((input as PluginToolProgress).message !== undefined) {
    normalized.message = String((input as PluginToolProgress).message).slice(0, 500)
  }

  return normalized
}

function createToolCallContext(requestId: string, toolName: string): PluginToolCallContext {
  let lastSentAt = 0
  const minIntervalMs = 100
  return {
    callId: requestId,
    sendProgress: (progress) => {
      const normalized = normalizeToolProgress(progress)
      if (!normalized) return
      const now = Date.now()
      if (now - lastSentAt < minIntervalMs) return
      lastSentAt = now
      send({
        id: requestId,
        type: 'toolProgress',
        payload: {
          toolName,
          callId: requestId,
          timestamp: now,
          ...normalized
        }
      })
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
          register: (name: string, toolHandler: (args: unknown, ctx?: PluginToolCallContext) => unknown | Promise<unknown>) => {
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

// 注入全局 mulby 对象，供后端代码直接调用，无需依赖 context 参数注入
;(globalThis as typeof globalThis & { mulby?: PluginAPI }).mulby = createProxyAPI()

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

  let rawModule: unknown

  // 检测模块格式
  if (isESModule(code)) {
    // ES Module 格式：使用动态 import()
    const cacheBuster = `?t=${Date.now()}`
    rawModule = await import(`file://${mainPath}${cacheBuster}`)
  } else {
    // CommonJS 格式：使用 Module._compile() 加载
    const Module = require('module') as typeof import('module')
    const ModuleConstructor = Module as unknown as NodeModuleConstructor
    const m = new ModuleConstructor(mainPath)
    m.filename = mainPath
    m.paths = ModuleConstructor._nodeModulePaths(dirname(mainPath))
    m._compile(code, mainPath)
    rawModule = m.exports
  }

  const rawRecord = isRecord(rawModule) ? rawModule : {}

  // 核心修复：融合解析 (Fallback Merge)
  // 解决 export default {} 短路覆盖所有顶层命名的重大 Bug，同时务必保留类实例形式的原型链与合法 `this` 引用
  let mergedModule: Record<string, unknown>
  if (isRecord(rawRecord.default)) {
    const isPlainObject = Object.getPrototypeOf(rawRecord.default) === Object.prototype
    if (isPlainObject) {
      mergedModule = { ...rawRecord.default, ...rawRecord }
      delete mergedModule.default
    } else {
      // 若对象是类实例（如 new Plugin()），强行展平会丢失所有 prototype 函数及破坏私有属性
      // 故保留其实例身份，仅把外层额外导出的属性混入其中 (以 default 为尊)
      mergedModule = rawRecord.default
      for (const key in rawRecord) {
        if (key !== 'default' && !(key in mergedModule)) {
          mergedModule[key] = rawRecord[key]
        }
      }
    }
  } else {
    mergedModule = { ...rawRecord }
    delete mergedModule.default
  }

  pluginState.module = mergedModule as PluginModule

  // 获取所有层级的有效暴露函数，包括类实例上的原型方法，用于终端打印
  const getAllMethods = (obj: unknown, prefix = ''): string[] => {
    const methods: string[] = []
    if (!obj || typeof obj !== 'object') return methods

    let current: object | null = obj
    while (current && current !== Object.prototype) {
      const currentRecord = current as Record<string, unknown>
      Object.getOwnPropertyNames(current).forEach(key => {
        if (key === 'constructor') return
        try {
          const val = currentRecord[key]
          if (typeof val === 'function') {
            const fullKey = prefix ? `${prefix}.${key}` : key
              if (!['run', 'onLoad', 'onIdleLoad', 'onUnload', 'onEnable', 'onDisable', 'onBackground', 'onForeground'].includes(fullKey)) {
              methods.push(fullKey)
            }
          } else if (!prefix && val && typeof val === 'object' && current === obj) {
            // 只向下深入一层对象域（例如 rpc.xx）
            methods.push(...getAllMethods(val, key))
          }
        } catch {}
      })
      current = Object.getPrototypeOf(current)
    }
    return methods
  }

  const registryNames = Array.from(new Set(getAllMethods(mergedModule)))
  
  if (registryNames.length > 0) {
    log.info(`[PluginWorker] Registered host interfaces: [${registryNames.join(', ')}]`)
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
      const result = await handler(toolArgs, createToolCallContext(request.id, toolName))
      const serializedResult = cloneForMessage(result)

      send({
        id: request.id,
        type: 'result',
        payload: { success: true, data: serializedResult }
      })
      return
    }

    const module = (await loadModule()) as Record<string, unknown>

    let targetMethod: HostCallable | undefined
    let isRpcNamespace = false

    // 新标准优先级 1：限制于精确特征签名域 rpc (消除隐式 context 入参)
    if (module.rpc && typeof module.rpc === 'object' && typeof (module.rpc as Record<string, unknown>)[method] === 'function') {
      targetMethod = (module.rpc as Record<string, unknown>)[method] as HostCallable
      isRpcNamespace = true
    }
    // 向后兼容优先级 2：检查 host 对象（隐式携带第一个 context 入参）
    else if (module.host && typeof module.host === 'object' && typeof (module.host as Record<string, unknown>)[method] === 'function') {
      targetMethod = (module.host as Record<string, unknown>)[method] as HostCallable
    }
    // 向后兼容优先级 3：检查顶层直接导出或其他常见对象
    else {
      if (typeof module[method] === 'function') {
        targetMethod = module[method] as HostCallable
      } else {
        const commonNames = ['api', 'methods', 'exports', 'handlers']
        for (const name of commonNames) {
          if (module[name] && typeof module[name] === 'object' && typeof (module[name] as Record<string, unknown>)[method] === 'function') {
            targetMethod = (module[name] as Record<string, unknown>)[method] as HostCallable
            break
          }
        }
      }
    }

    // 如果找不到方法，抛出详细的错误信息
    if (!targetMethod) {
      const getAllMethods = (obj: unknown, prefix = ''): string[] => {
        const methods: string[] = []
        if (!obj || typeof obj !== 'object') return methods
        let current: object | null = obj
        while (current && current !== Object.prototype) {
          const currentRecord = current as Record<string, unknown>
          Object.getOwnPropertyNames(current).forEach(key => {
            if (key === 'constructor') return
            try {
              const val = currentRecord[key]
              if (typeof val === 'function') {
                const fullKey = prefix ? `${prefix}.${key}` : key
                if (!['run', 'onLoad', 'onIdleLoad', 'onUnload', 'onEnable', 'onDisable', 'onBackground', 'onForeground'].includes(fullKey)) {
                  methods.push(fullKey)
                }
              } else if (!prefix && val && typeof val === 'object' && current === obj) {
                methods.push(...getAllMethods(val, key))
              }
            } catch {}
          })
          current = Object.getPrototypeOf(current)
        }
        return methods
      }
      
      const availableMethods = Array.from(new Set(getAllMethods(module)))

      throw new Error(
        `Host method not found: ${method}\n` +
        `Available methods: ${availableMethods.length > 0 ? availableMethods.join(', ') : 'none'}\n` +
        `Tip: Export methods in a 'rpc' object (export const rpc = { ${method} })`
      )
    }

    let result: unknown

    // 若方法存放于 rpc 域内，严格按照前端传递参数调用，且保留该函数的 receiver 以支持 'this' 作用域
    if (isRpcNamespace) {
      result = await targetMethod.apply(module.rpc, Array.isArray(args) ? args : [])
    } else {
      // 执行老旧兼容逻辑，确保现有市场插件依然正常运转
      const api = createProxyAPI()
      const context = { api }
      result = await targetMethod(context, ...(Array.isArray(args) ? args : []))
    }

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
