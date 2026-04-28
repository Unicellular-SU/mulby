import { ipcMain } from 'electron'
import sharp, { Sharp, SharpOptions } from 'sharp'
import log from 'electron-log'

/**
 * Sharp 图像处理 IPC 处理器
 *
 * 由于 Sharp 实例包含原生绑定，无法直接通过 IPC 序列化传递，
 * 采用「操作链序列化」模式：
 * 1. 渲染进程构建操作链（记录方法调用）
 * 2. 通过 IPC 传递序列化的操作链
 * 3. 主进程重建 Sharp 实例并执行操作
 */

export interface SharpOperation {
  method: string
  args: unknown[]
}

type SharpInputObject = Record<string, unknown>

export interface SharpExecutePayload {
  input?: string | Buffer | ArrayBuffer | ArrayBufferView | SharpInputObject | unknown[]
  options?: SharpOptions
  operations: SharpOperation[]
}

// 终结方法（返回 Promise）
const TERMINAL_METHODS = ['toBuffer', 'toFile', 'metadata', 'stats'] as const
const TERMINAL_METHOD_SET = new Set<string>(TERMINAL_METHODS as readonly string[])

function normalizeSharpValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (Array.isArray(value)) return value.map(normalizeSharpValue)
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = normalizeSharpValue(nestedValue)
    }
    return normalized
  }
  return value
}

function serializeSharpResult(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
  }
  if (value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
  }
  if (Array.isArray(value)) return value.map(serializeSharpResult)
  if (value && typeof value === 'object') {
    const serialized: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      serialized[key] = serializeSharpResult(nestedValue)
    }
    return serialized
  }
  return value
}

export async function executeSharpOperations(payload: SharpExecutePayload): Promise<unknown> {
  const { input, options, operations } = payload

  // 创建 Sharp 实例（Sharp 必须要有输入：路径、Buffer 或 ArrayBuffer）
  let instance: Sharp
  if (input === undefined || input === null) {
    throw new Error('Sharp 需要输入：请传入图片文件路径、Buffer 或 ArrayBuffer，例如 mulby.sharp(文件路径) 或 mulby.sharp(图片Buffer)')
  } else if (typeof input === 'string') {
    log.info('[Sharp] 创建: 文件路径 =', input)
    instance = sharp(input, options)
  } else if (Buffer.isBuffer(input)) {
    log.info('[Sharp] 创建: Buffer')
    instance = sharp(input, options)
  } else if (input instanceof ArrayBuffer) {
    log.info('[Sharp] 创建: ArrayBuffer')
    instance = sharp(Buffer.from(input), options)
  } else if (ArrayBuffer.isView(input)) {
    log.info('[Sharp] 创建: ArrayBufferView')
    instance = sharp(
      Buffer.from(input.buffer, input.byteOffset, input.byteLength),
      options
    )
  } else if (Array.isArray(input)) {
    log.info('[Sharp] 创建: 数组')
    instance = sharp(normalizeSharpValue(input) as unknown as Buffer, options)
  } else if (typeof input === 'object') {
    log.info('[Sharp] 创建: 对象 keys =', Object.keys(input))
    instance = sharp(normalizeSharpValue(input) as unknown as Parameters<typeof sharp>[0], options)
  } else {
    throw new Error('不支持的输入类型')
  }

  if (instance == null || typeof (instance as unknown as Record<string, unknown>)[operations[0]?.method ?? ''] !== 'function') {
    throw new Error('Sharp 实例创建异常或输入数据无效，请确保已传入有效的图片（路径、Buffer 或 ArrayBuffer）')
  }

  // 执行操作链
  for (const { method, args } of operations) {
    log.info('[Sharp] 执行:', method)

    const methodMap = instance as unknown as Record<string, (...methodArgs: unknown[]) => unknown>
    const methodFn = methodMap[method]
    if (typeof methodFn !== 'function') {
      throw new Error(`Sharp 不存在方法: ${method}`)
    }

    // 必须用 instance 作为 this 调用，否则 Sharp 内部 this.options 为 undefined
    const result = methodFn.call(instance, ...args.map(normalizeSharpValue))

    // 链式方法必须返回新的 Sharp 实例
    if (!TERMINAL_METHOD_SET.has(method)) {
      if (result == null) {
        throw new Error(`Sharp 链式方法 ${method}() 返回了空值，当前输入或上一步结果可能无效`)
      }
      instance = result as Sharp
    }

    // 终结方法返回 Promise
    if (TERMINAL_METHOD_SET.has(method)) {
      log.info('[Sharp] 终结方法:', method)
      const finalResult = await result

      log.info('[Sharp] 结果 typeof:', typeof finalResult)
      log.info('[Sharp] 结果 isBuffer:', Buffer.isBuffer(finalResult))
      log.info('[Sharp] 结果 constructor:', (finalResult as { constructor?: { name?: string } })?.constructor?.name)

      return serializeSharpResult(finalResult)
    }
  }

  log.info('[Sharp] 警告: 没有终结方法')
  return undefined
}

export function registerSharpHandlers() {
  // 执行 Sharp 操作链
  ipcMain.handle('sharp:execute', async (_event, payload: SharpExecutePayload) => {
    log.info('[Sharp] ========== 收到请求 ==========')
    log.info('[Sharp] payload input type:', typeof payload.input)
    log.info('[Sharp] payload input value:', typeof payload.input === 'string' ? payload.input : '[非字符串]')
    log.info('[Sharp] operations:', payload.operations.map(op => op.method).join(' -> '))

    try {
      return await executeSharpOperations(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      log.error('[Sharp] 错误:', message)
      log.error('[Sharp] 堆栈:', stack)
      throw new Error(`Sharp 操作失败: ${message}`)
    }
  })

  // 获取 Sharp 版本信息（用于调试）
  ipcMain.handle('sharp:version', () => {
    return {
      sharp: sharp.versions,
      format: sharp.format,
    }
  })
}
