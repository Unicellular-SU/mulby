/**
 * Plugin Message Bus
 * Phase 4: 插件间通信机制
 *
 * 提供插件之间的消息传递和事件通信能力
 */

import { EventEmitter } from 'events'

// ============ 类型定义 ============

export interface PluginMessage {
  id: string              // 消息 ID
  from: string            // 发送者插件 ID
  to?: string             // 接收者插件 ID（可选，不指定则为广播）
  type: string            // 消息类型
  payload: unknown        // 消息内容
  timestamp: number       // 时间戳
}

interface MessageHandler {
  pluginId: string
  handler: (message: PluginMessage) => void | Promise<void>
}

// ============ 消息总线 ============

export class PluginMessageBus extends EventEmitter {
  private handlers: Map<string, MessageHandler[]> = new Map()
  private messageHistory: PluginMessage[] = []
  private maxHistorySize = 100  // 最多保留 100 条历史消息

  /**
   * 注册消息处理器
   */
  subscribe(pluginId: string, handler: (message: PluginMessage) => void | Promise<void>): void {
    const handlers = this.handlers.get(pluginId) || []
    handlers.push({ pluginId, handler })
    this.handlers.set(pluginId, handlers)

    console.log(`[MessageBus] Plugin ${pluginId} subscribed to messages`)
  }

  /**
   * 取消注册消息处理器
   */
  unsubscribe(pluginId: string, handler?: (message: PluginMessage) => void | Promise<void>): void {
    if (!handler) {
      // 移除该插件的所有处理器
      this.handlers.delete(pluginId)
      console.log(`[MessageBus] Plugin ${pluginId} unsubscribed from all messages`)
      return
    }

    const handlers = this.handlers.get(pluginId)
    if (!handlers) return

    const index = handlers.findIndex(h => h.handler === handler)
    if (index !== -1) {
      handlers.splice(index, 1)
      if (handlers.length === 0) {
        this.handlers.delete(pluginId)
      } else {
        this.handlers.set(pluginId, handlers)
      }
      console.log(`[MessageBus] Plugin ${pluginId} unsubscribed from specific handler`)
    }
  }

  /**
   * 发送消息到指定插件
   */
  async send(from: string, to: string, type: string, payload: unknown): Promise<void> {
    const message: PluginMessage = {
      id: this.generateMessageId(),
      from,
      to,
      type,
      payload,
      timestamp: Date.now()
    }

    // 记录到历史
    this.addToHistory(message)

    // 触发全局事件（用于监控和日志）
    this.emit('message:sent', message)

    // 分发消息到目标插件
    await this.deliverMessage(message, to)
  }

  /**
   * 广播消息到所有插件（除了发送者自己）
   */
  async broadcast(from: string, type: string, payload: unknown): Promise<void> {
    const message: PluginMessage = {
      id: this.generateMessageId(),
      from,
      type,
      payload,
      timestamp: Date.now()
    }

    // 记录到历史
    this.addToHistory(message)

    // 触发全局事件
    this.emit('message:broadcast', message)

    // 分发消息到所有订阅的插件（除了发送者）
    const deliveryPromises: Promise<void>[] = []
    for (const [pluginId] of this.handlers) {
      if (pluginId !== from) {
        deliveryPromises.push(this.deliverMessage(message, pluginId))
      }
    }

    await Promise.allSettled(deliveryPromises)
  }

  /**
   * 分发消息到指定插件
   */
  private async deliverMessage(message: PluginMessage, targetPluginId: string): Promise<void> {
    const handlers = this.handlers.get(targetPluginId)
    if (!handlers || handlers.length === 0) {
      console.warn(`[MessageBus] No handlers for plugin ${targetPluginId}`)
      return
    }

    // 调用所有处理器
    const handlerPromises = handlers.map(async ({ handler }) => {
      try {
        await handler(message)
      } catch (err) {
        console.error(`[MessageBus] Error in message handler for plugin ${targetPluginId}:`, err)
        this.emit('message:error', { message, targetPluginId, error: err })
      }
    })

    await Promise.allSettled(handlerPromises)
  }

  /**
   * 添加消息到历史记录
   */
  private addToHistory(message: PluginMessage): void {
    this.messageHistory.push(message)

    // 限制历史记录大小
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift()
    }
  }

  /**
   * 获取消息历史
   */
  getHistory(pluginId?: string, limit = 50): PluginMessage[] {
    let history = this.messageHistory

    // 如果指定了插件 ID，只返回与该插件相关的消息
    if (pluginId) {
      history = history.filter(msg => msg.from === pluginId || msg.to === pluginId)
    }

    // 返回最近的 N 条消息
    return history.slice(-limit)
  }

  /**
   * 清理插件相关的所有数据
   */
  cleanup(pluginId: string): void {
    // 移除处理器
    this.handlers.delete(pluginId)

    // 清理历史记录中的相关消息（可选，避免内存泄漏）
    // 注意：这里不清理历史消息，因为其他插件可能需要查看

    console.log(`[MessageBus] Cleaned up plugin ${pluginId}`)
  }

  /**
   * 生成消息 ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    subscriberCount: number
    messageCount: number
    subscribers: string[]
  } {
    return {
      subscriberCount: this.handlers.size,
      messageCount: this.messageHistory.length,
      subscribers: Array.from(this.handlers.keys())
    }
  }
}
