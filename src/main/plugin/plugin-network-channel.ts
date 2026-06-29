/**
 * 插件网络请求通道
 *
 * 一个进程内的轻量事件总线，把"插件触发的网络请求"从各个采集点
 * （ipc/http、ipc/ai、host-manager 的 apiCall、worker 回传的后端请求）
 * 解耦地汇聚到唯一的消费方 {@link setupPluginNetworkBridge}，由后者在
 * 开发者模式下回灌到插件 DevTools 控制台。
 *
 * 设计要点：
 * - 纯主进程模块，worker 不引用它（worker 只发 NetworkResponse 消息）。
 * - 通过 {@link PluginNetworkChannel.setGate} 注入"是否启用"判定，唯一来源，
 *   各采集点用 {@link PluginNetworkChannel.enabled} 做廉价短路，正常用户零开销。
 */
import { EventEmitter } from 'events'
import type { PluginNetworkRecord } from './host-protocol'

export type { PluginNetworkRecord }

/** 事件名：携带 (pluginId, record) */
export const PLUGIN_NETWORK_RECORD_EVENT = 'record'

type Gate = () => boolean

class PluginNetworkChannel extends EventEmitter {
  private gate: Gate = () => false

  /** 由 bridge 在装配时注入开发者模式判定（唯一启用来源） */
  setGate(gate: Gate): void {
    this.gate = gate
  }

  /** 当前是否启用采集（开发者模式）。任何异常都视为关闭，保证零副作用。 */
  get enabled(): boolean {
    try {
      return this.gate() === true
    } catch {
      return false
    }
  }

  /** 上报一条网络记录（pluginId 必须为 plugin.id） */
  report(pluginId: string, record: PluginNetworkRecord): void {
    if (!pluginId) return
    this.emit(PLUGIN_NETWORK_RECORD_EVENT, pluginId, record)
  }
}

export const pluginNetworkChannel = new PluginNetworkChannel()

const MAX_PREVIEW_CHARS = 2048

/**
 * 把任意请求/响应体安全地裁剪为可读预览字符串。
 * 二进制（Buffer/ArrayBuffer）只标注大小，避免乱码与体积膨胀。
 */
export function truncatePreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  try {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return `<Buffer ${value.length} bytes>`
    }
    if (value instanceof ArrayBuffer) {
      return `<ArrayBuffer ${value.byteLength} bytes>`
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (typeof text !== 'string') return undefined
    if (text.length > MAX_PREVIEW_CHARS) {
      return `${text.slice(0, MAX_PREVIEW_CHARS)}… (+${text.length - MAX_PREVIEW_CHARS} chars)`
    }
    return text
  } catch {
    return undefined
  }
}

/**
 * 把后端 mulby.http 的 apiCall 参数（method + args）归一化为记录字段。
 * 对应 PluginHttp 的便捷方法签名：
 * - request(options) / get(url, headers) / post(url, body, headers) / put(...) / delete(url, headers)
 */
export function normalizeHttpCall(
  method: string,
  args: unknown[]
): { url: string; httpMethod: string; headers?: Record<string, string>; body?: unknown } {
  if (method === 'request') {
    const o = (args[0] || {}) as {
      url?: string
      method?: string
      headers?: Record<string, string>
      body?: unknown
    }
    return { url: String(o.url || ''), httpMethod: o.method || 'GET', headers: o.headers, body: o.body }
  }
  const url = String(args[0] || '')
  if (method === 'post' || method === 'put') {
    return {
      url,
      httpMethod: method.toUpperCase(),
      body: args[1],
      headers: args[2] as Record<string, string> | undefined
    }
  }
  // get / delete / head
  return { url, httpMethod: method.toUpperCase(), headers: args[1] as Record<string, string> | undefined }
}
