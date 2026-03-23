/**
 * OpenClaw Node 模块入口
 *
 * 组合 client + registry + handlers，提供统一的 OpenClawNodeService 接口。
 */

import type { OpenClawSettings } from '../../shared/types/settings'
import type { NodeStatusInfo } from '../../shared/types/openclaw-protocol'
import { OpenClawNodeClient } from './node-client'
import { CommandRegistry } from './command-registry'
import { createSystemHandlers, type SystemHandlerDeps } from './handlers/system-handler'
import { createMulbyHandlers, type MulbyHandlerDeps } from './handlers/mulby-handler'
import { createCanvasHandlers, type CanvasHandlerDeps } from './handlers/canvas-handler'

export interface OpenClawNodeServiceDeps extends SystemHandlerDeps, MulbyHandlerDeps {
  /** Canvas 命令所需的依赖（可选，不提供则不注册 canvas 命令） */
  canvas?: CanvasHandlerDeps
}

/**
 * OpenClaw Node Service — 对外统一接口
 *
 * 使用方式（在主进程 index.ts 中）：
 * ```ts
 * const openclawService = createOpenClawNodeService(deps)
 * openclawService.onStatusChanged((status) => { ... })
 * if (settings.openclaw.enabled && settings.openclaw.node.autoConnect) {
 *   await openclawService.connect(settings.openclaw)
 * }
 * ```
 */
export class OpenClawNodeService {
  private client: OpenClawNodeClient
  private registry: CommandRegistry

  constructor(deps: OpenClawNodeServiceDeps) {
    this.registry = new CommandRegistry()
    this.client = new OpenClawNodeClient(this.registry)

    // 注册标准命令
    const systemHandlers = createSystemHandlers(deps)
    for (const [name, meta] of Object.entries(systemHandlers)) {
      this.registry.register({
        name,
        description: meta.description,
        cap: meta.cap,
        handler: meta.handler,
        requiresExecApproval: meta.requiresExecApproval
      })
    }

    // 注册 Mulby 自定义命令
    const mulbyHandlers = createMulbyHandlers(deps)
    for (const [name, meta] of Object.entries(mulbyHandlers)) {
      this.registry.register({
        name,
        description: meta.description,
        cap: meta.cap,
        handler: meta.handler
      })
    }

    // 注册 Canvas 命令（如果提供了依赖）
    const canvasDeps = deps.canvas || { getMainWindow: () => null }
    const canvasHandlers = createCanvasHandlers(canvasDeps)
    for (const [name, meta] of Object.entries(canvasHandlers)) {
      this.registry.register({
        name,
        description: meta.description,
        cap: meta.cap,
        handler: meta.handler
      })
    }
  }

  /** 连接到 OpenClaw Gateway */
  async connect(settings: OpenClawSettings): Promise<void> {
    return this.client.connect(settings)
  }

  /** 断开连接 */
  disconnect(): void {
    this.client.disconnect()
  }

  /** 热更新设置（安全策略即时生效，enabled=false 时主动断连） */
  updateSettings(settings: OpenClawSettings): void {
    this.client.updateSettings(settings)
  }

  /** 获取当前连接状态 */
  getStatus(): NodeStatusInfo {
    return this.client.getStatus()
  }

  /** 测试 Gateway 连通性 */
  async testConnection(settings: OpenClawSettings): Promise<{ ok: boolean; error?: string }> {
    return this.client.testConnection(settings)
  }

  /** 设置保存 device token 的回调 */
  setSaveDeviceTokenCallback(callback: (token: string) => void): void {
    this.client.setSaveDeviceTokenCallback(callback)
  }

  /** 监听状态变化 */
  onStatusChanged(callback: (status: NodeStatusInfo) => void): () => void {
    this.client.on('statusChanged', callback)
    return () => this.client.off('statusChanged', callback)
  }

  /** 监听命令调用事件 */
  onInvoked(callback: (command: string, success: boolean) => void): () => void {
    this.client.on('invoked', callback)
    return () => this.client.off('invoked', callback)
  }

  /** 监听错误事件 */
  onError(callback: (error: Error) => void): () => void {
    this.client.on('error', callback)
    return () => this.client.off('error', callback)
  }

  /** 销毁服务（app 退出时调用） */
  destroy(): void {
    this.client.destroy()
  }
}

/** 便捷工厂函数 */
export function createOpenClawNodeService(deps: OpenClawNodeServiceDeps): OpenClawNodeService {
  return new OpenClawNodeService(deps)
}
