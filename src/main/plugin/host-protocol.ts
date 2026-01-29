/**
 * Plugin Host 通信协议
 * 定义主进程与 UtilityProcess 之间的消息格式
 */

import type { InputAttachment } from '../../shared/types/plugin'

// ============ 消息类型 ============

/** 主进程 -> Worker 的请求类型 */
export type HostRequestType =
  | 'init'        // 初始化插件
  | 'run'         // 执行插件
  | 'callHook'    // 调用生命周期钩子
  | 'callTaskCallback'  // 调用任务回调
  | 'terminate'   // 终止插件

/** Worker -> 主进程的响应类型 */
export type HostResponseType =
  | 'ready'       // Worker 就绪
  | 'result'      // 执行结果
  | 'error'       // 错误
  | 'apiCall'     // API 调用请求
  | 'resourceStats' // 资源统计

// ============ 请求消息 ============

/** 基础请求结构 */
export interface HostRequestBase {
  id: string
  type: HostRequestType
}

/** 初始化请求 */
export interface InitRequest extends HostRequestBase {
  type: 'init'
  payload: {
    pluginName: string
    pluginPath: string
    mainFile: string
  }
}

/** 执行请求 */
export interface RunRequest extends HostRequestBase {
  type: 'run'
  payload: {
    featureCode: string
    input: string
    attachments?: InputAttachment[]
  }
}

/** 钩子调用请求 */
export interface CallHookRequest extends HostRequestBase {
  type: 'callHook'
  payload: {
    hookName: 'onLoad' | 'onUnload' | 'onEnable' | 'onDisable' | 'onBackground' | 'onForeground'
  }
}

/** 任务回调调用请求 */
export interface CallTaskCallbackRequest extends HostRequestBase {
  type: 'callTaskCallback'
  payload: {
    callbackName: string
    payload: unknown
    task: unknown
  }
}

/** 终止请求 */
export interface TerminateRequest extends HostRequestBase {
  type: 'terminate'
  payload: null
}

export type HostRequest = InitRequest | RunRequest | CallHookRequest | CallTaskCallbackRequest | TerminateRequest

// ============ 响应消息 ============

/** 基础响应结构 */
export interface HostResponseBase {
  id: string
  type: HostResponseType
}

/** 就绪响应 */
export interface ReadyResponse extends HostResponseBase {
  type: 'ready'
  payload: null
}

/** 结果响应 */
export interface ResultResponse extends HostResponseBase {
  type: 'result'
  payload: {
    success: boolean
    data?: unknown
    heartbeat?: boolean  // 心跳标记
  }
}

/** 错误响应 */
export interface ErrorResponse extends HostResponseBase {
  type: 'error'
  payload: {
    message: string
    stack?: string
  }
}

/** API 调用请求（Worker -> 主进程） */
export interface ApiCallResponse extends HostResponseBase {
  type: 'apiCall'
  payload: {
    api: string      // API 路径，如 'clipboard.readText'
    args: unknown[]  // 参数列表
  }
}

/** 资源统计响应（Worker -> 主进程） */
export interface ResourceStatsResponse extends HostResponseBase {
  type: 'resourceStats'
  payload: {
    memoryUsage: {
      rss: number        // 常驻集大小（字节）
      heapTotal: number  // 堆总大小（字节）
      heapUsed: number   // 已使用堆（字节）
      external: number   // 外部内存（字节）
    }
    cpuUsage: {
      user: number       // 用户 CPU 时间（微秒）
      system: number     // 系统 CPU 时间（微秒）
    }
  }
}

export type HostResponse = ReadyResponse | ResultResponse | ErrorResponse | ApiCallResponse | ResourceStatsResponse

// ============ API 响应（主进程 -> Worker） ============

/** API 调用结果 */
export interface ApiResult {
  id: string
  success: boolean
  data?: unknown
  error?: string
}

// ============ 辅助函数 ============

/** 生成唯一请求 ID */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/** 创建请求消息 */
export function createRequest<T extends HostRequest['type']>(
  type: T,
  payload: Extract<HostRequest, { type: T }>['payload']
): Extract<HostRequest, { type: T }> {
  return {
    id: generateRequestId(),
    type,
    payload
  } as Extract<HostRequest, { type: T }>
}

/** 创建响应消息 */
export function createResponse<T extends HostResponse['type']>(
  id: string,
  type: T,
  payload: Extract<HostResponse, { type: T }>['payload']
): Extract<HostResponse, { type: T }> {
  return {
    id,
    type,
    payload
  } as Extract<HostResponse, { type: T }>
}
