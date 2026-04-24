/**
 * IPC 调用方策略中间件
 *
 * 为 `ipcMain.handle` / `ipcMain.on` 提供统一的"调用源校验 + 身份注入"包装。
 *
 * 背景：仓库早期只在 `ipc/shell.ts` 的高危 `runCommand` 通道上手动调用
 * `resolveIpcCallerSource`。storage / filesystem / http 等大量通道则默认
 * 信任 renderer 传入的参数（如 `namespace` / `path`），允许插件 A 读取
 * 插件 B 的 SQLite 数据或 plugin-data 目录，造成跨插件越权。
 *
 * 本文件把"校验 + 注入"抽成三个包装器，新增 IPC handler 时可以直接套用：
 *
 * - `appOnlyInvoke(fn)` / `appOnlyOn(fn)` —— 仅允许主应用窗口调用（settings、
 *   系统页、deep-link 等敏感通道）。非 app 来源会直接 throw。
 * - `pluginAwareInvoke(fn)` / `pluginAwareOn(fn)` —— 允许主应用 + 插件，
 *   把解析好的 `IpcCallerInfo` 作为第一个参数注入；handler 可以据此把
 *   pluginId 强制带入业务层（如 storage 使用它作为 SQL namespace 前缀）。
 * - `anyTrustedInvoke(fn)` —— 允许 app + plugin，但不特别区分。用于
 *   低敏感、无需身份的通道（通常不需要，除非迁移成本太高）。
 *
 * 任何 handler 遇到 `source: 'untrusted'` 一律 throw `IpcPolicyError`，
 * 确保未登记窗口（未来新增忘记 register 的窗口）不会静默越权。
 */

import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron'
import { resolveIpcCallerSource, type IpcCallerInfo } from '../../services/ipc-caller-resolver'

/** IPC 策略校验失败 */
export class IpcPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpcPolicyError'
  }
}

// ==================== appOnly ====================

/**
 * 仅允许主应用窗口调用的 `ipcMain.handle` 包装
 *
 * 等价于在 handler 开头写：
 * ```ts
 * const caller = resolveIpcCallerSource(event.sender)
 * if (caller.source !== 'app') throw new IpcPolicyError('仅主应用可调用')
 * ```
 * 但不再需要每个 handler 重复这段样板。
 */
export function appOnlyInvoke<Args extends unknown[], R>(
  fn: (event: IpcMainInvokeEvent, ...args: Args) => R | Promise<R>
): (event: IpcMainInvokeEvent, ...args: Args) => Promise<R> {
  return async (event, ...args) => {
    const caller = resolveIpcCallerSource(event.sender)
    if (caller.source !== 'app') {
      throw new IpcPolicyError(`仅主应用可调用该 IPC 通道（调用源：${caller.source}）`)
    }
    return await fn(event, ...args)
  }
}

/**
 * 仅允许主应用窗口发送的 `ipcMain.on` 包装。
 * 非 app 来源会被静默丢弃并打印 warn（保持 `on` 语义：不抛错）。
 */
export function appOnlyOn<Args extends unknown[]>(
  fn: (event: IpcMainEvent, ...args: Args) => void
): (event: IpcMainEvent, ...args: Args) => void {
  return (event, ...args) => {
    const caller = resolveIpcCallerSource(event.sender)
    if (caller.source !== 'app') {
      console.warn(`[IPC] 丢弃非主应用来源的 on 消息（source=${caller.source}）`)
      return
    }
    fn(event, ...args)
  }
}

// ==================== pluginAware ====================

/**
 * 允许主应用和插件调用，把 `IpcCallerInfo` 作为第一个参数注入 `ipcMain.handle`。
 *
 * 典型用法：
 * ```ts
 * ipcMain.handle('storage:get', pluginAwareInvoke((caller, _event, key) => {
 *   const ns = caller.source === 'plugin' ? `plugin:${caller.pluginId}` : 'app'
 *   return dbGet(ns, key)
 * }))
 * ```
 */
export function pluginAwareInvoke<Args extends unknown[], R>(
  fn: (caller: IpcCallerInfo, event: IpcMainInvokeEvent, ...args: Args) => R | Promise<R>
): (event: IpcMainInvokeEvent, ...args: Args) => Promise<R> {
  return async (event, ...args) => {
    const caller = resolveIpcCallerSource(event.sender)
    if (caller.source === 'untrusted') {
      throw new IpcPolicyError('拒绝未登记窗口调用 IPC')
    }
    return await fn(caller, event, ...args)
  }
}

/**
 * `ipcMain.on` 版本的 pluginAware。未登记窗口静默丢弃 + 告警。
 */
export function pluginAwareOn<Args extends unknown[]>(
  fn: (caller: IpcCallerInfo, event: IpcMainEvent, ...args: Args) => void
): (event: IpcMainEvent, ...args: Args) => void {
  return (event, ...args) => {
    const caller = resolveIpcCallerSource(event.sender)
    if (caller.source === 'untrusted') {
      console.warn('[IPC] 丢弃未登记窗口的 on 消息')
      return
    }
    fn(caller, event, ...args)
  }
}

// ==================== 工具：插件专用 namespace 计算 ====================

/** 存储层对 pluginId 的命名空间前缀，与 `plugin/storage.ts` 保持一致 */
const PLUGIN_STORAGE_NS_PREFIX = 'plugin:'

/**
 * 基于 IPC 调用方计算存储层命名空间。
 *
 * - 主应用：允许使用 renderer 传入的 `rawNamespace`（仍保留 undefined → 'global' 的兼容行为）
 * - 插件：**强制**为 `plugin:${pluginId}`，忽略 renderer 传入的值
 *   （防止插件 A 通过传入其它 pluginId 读写别人的数据）
 *
 * @returns 实际写入 SQLite 的 `plugin_id` 列值
 */
export function resolveStorageNamespace(caller: IpcCallerInfo, rawNamespace?: string): string {
  if (caller.source === 'plugin' && caller.pluginId) {
    return `${PLUGIN_STORAGE_NS_PREFIX}${caller.pluginId}`
  }
  // app 来源保持旧语义
  return rawNamespace && rawNamespace.length > 0 ? rawNamespace : 'global'
}
