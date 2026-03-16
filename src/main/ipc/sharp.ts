import { ipcMain } from 'electron'
import sharp, { Sharp, SharpOptions } from 'sharp'

/**
 * Sharp 图像处理 IPC 处理器
 *
 * 由于 Sharp 实例包含原生绑定，无法直接通过 IPC 序列化传递，
 * 采用「操作链序列化」模式：
 * 1. 渲染进程构建操作链（记录方法调用）
 * 2. 通过 IPC 传递序列化的操作链
 * 3. 主进程重建 Sharp 实例并执行操作
 */

interface SharpOperation {
  method: string
  args: unknown[]
}

type SharpInputObject = Record<string, unknown>

interface SharpExecutePayload {
  input?: string | Buffer | ArrayBuffer | ArrayBufferView | SharpInputObject | unknown[]
  options?: SharpOptions
  operations: SharpOperation[]
}

// 终结方法（返回 Promise）
const TERMINAL_METHODS = ['toBuffer', 'toFile', 'metadata', 'stats', 'raw', 'clone'] as const
const TERMINAL_METHOD_SET = new Set<string>(TERMINAL_METHODS as readonly string[])

export function registerSharpHandlers() {
  // 执行 Sharp 操作链
  ipcMain.handle('sharp:execute', async (_event, payload: SharpExecutePayload) => {
    console.log('[Sharp] ========== 收到请求 ==========')
    console.log('[Sharp] payload input type:', typeof payload.input)
    console.log('[Sharp] payload input value:', typeof payload.input === 'string' ? payload.input : '[非字符串]')
    console.log('[Sharp] operations:', payload.operations.map(op => op.method).join(' -> '))

    try {
      const { input, options, operations } = payload

      // 创建 Sharp 实例（Sharp 必须要有输入：路径、Buffer 或 ArrayBuffer）
      let instance: Sharp
      if (input === undefined || input === null) {
        throw new Error('Sharp 需要输入：请传入图片文件路径、Buffer 或 ArrayBuffer，例如 mulby.sharp(文件路径) 或 mulby.sharp(图片Buffer)')
      } else if (typeof input === 'string') {
        console.log('[Sharp] 创建: 文件路径 =', input)
        instance = sharp(input, options)
      } else if (Buffer.isBuffer(input)) {
        console.log('[Sharp] 创建: Buffer')
        instance = sharp(input, options)
      } else if (input instanceof ArrayBuffer) {
        console.log('[Sharp] 创建: ArrayBuffer')
        instance = sharp(Buffer.from(input), options)
      } else if (ArrayBuffer.isView(input)) {
        console.log('[Sharp] 创建: ArrayBufferView')
        instance = sharp(
          Buffer.from(input.buffer, input.byteOffset, input.byteLength),
          options
        )
      } else if (Array.isArray(input)) {
        console.log('[Sharp] 创建: 数组')
        instance = sharp(input as unknown as Buffer, options)
      } else if (typeof input === 'object') {
        console.log('[Sharp] 创建: 对象 keys =', Object.keys(input))
        instance = sharp(input as unknown as Parameters<typeof sharp>[0], options)
      } else {
        throw new Error('不支持的输入类型')
      }

      if (instance == null || typeof (instance as unknown as Record<string, unknown>)[operations[0]?.method ?? ''] !== 'function') {
        throw new Error('Sharp 实例创建异常或输入数据无效，请确保已传入有效的图片（路径、Buffer 或 ArrayBuffer）')
      }

      // 执行操作链
      for (const { method, args } of operations) {
        console.log('[Sharp] 执行:', method)

        const methodMap = instance as unknown as Record<string, (...methodArgs: unknown[]) => unknown>
        const methodFn = methodMap[method]
        if (typeof methodFn !== 'function') {
          throw new Error(`Sharp 不存在方法: ${method}`)
        }

        // 必须用 instance 作为 this 调用，否则 Sharp 内部 this.options 为 undefined
        const result = methodFn.call(instance, ...args)

        // 链式方法必须返回新的 Sharp 实例
        if (!TERMINAL_METHOD_SET.has(method)) {
          if (result == null) {
            throw new Error(`Sharp 链式方法 ${method}() 返回了空值，当前输入或上一步结果可能无效`)
          }
          instance = result as Sharp
        }

        // 终结方法返回 Promise
        if (TERMINAL_METHOD_SET.has(method)) {
          console.log('[Sharp] 终结方法:', method)
          const finalResult = await result

          console.log('[Sharp] 结果 typeof:', typeof finalResult)
          console.log('[Sharp] 结果 isBuffer:', Buffer.isBuffer(finalResult))
          console.log('[Sharp] 结果 constructor:', (finalResult as { constructor?: { name?: string } })?.constructor?.name)

          // 处理 Buffer 类型，转换为 ArrayBuffer 以便 IPC 序列化
          if (Buffer.isBuffer(finalResult)) {
            console.log('[Sharp] 转换 Buffer, 长度:', finalResult.length)
            // 使用 slice 创建新的 ArrayBuffer，避免共享内存问题
            const arrayBuffer = finalResult.buffer.slice(
              finalResult.byteOffset,
              finalResult.byteOffset + finalResult.byteLength
            )
            console.log('[Sharp] ArrayBuffer 字节长度:', arrayBuffer.byteLength)
            return arrayBuffer
          }

          // 处理 metadata 返回的对象，其中可能包含 Buffer 字段
          if (method === 'metadata' && finalResult && typeof finalResult === 'object') {
            console.log('[Sharp] 处理 metadata')
            const serializable: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(finalResult as Record<string, unknown>)) {
              if (Buffer.isBuffer(value)) {
                console.log('[Sharp] metadata Buffer 字段:', key)
                serializable[key] = value.toString('base64')
              } else {
                serializable[key] = value
              }
            }
            console.log('[Sharp] metadata keys:', Object.keys(serializable))
            return serializable
          }

          // 处理 toFile 返回的 info 对象
          if (method === 'toFile' && finalResult && typeof finalResult === 'object') {
            console.log('[Sharp] toFile info:', finalResult)
            return JSON.parse(JSON.stringify(finalResult))
          }

          console.log('[Sharp] 返回原始结果')
          return finalResult
        }
      }

      console.log('[Sharp] 警告: 没有终结方法')
      return undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      console.error('[Sharp] 错误:', message)
      console.error('[Sharp] 堆栈:', stack)
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
