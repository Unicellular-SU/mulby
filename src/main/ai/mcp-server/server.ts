/**
 * Mulby MCP Server 核心实现
 *
 * 将 PluginToolRegistry 中的插件工具通过标准 MCP 协议暴露给外部 AI 工具
 * （如 Claude Desktop、Cursor、Cline 等）。
 *
 * 设计要点：
 * - 使用 @modelcontextprotocol/sdk 的底层 Server API（不是 McpServer 高层封装）
 *   因为 McpServer.tool() 仅接受 Zod schema，而插件的 inputSchema 是 JSON Schema
 * - 工厂模式：每个请求创建新的 Server + Transport 对，符合 MCP SDK 的无状态模式要求
 * - 工具注册表（registeredTools）在所有 per-request Server 实例间共享
 * - 工具调用复用现有 PluginManager.hostManager 管道
 * - 工具名称格式：mulby__{sanitizedPluginId}__{toolName}
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import type { PluginToolRegistry } from '../../plugin/plugin-tools'
import type { PluginManager } from '../../plugin'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

// MCP Tool ID 前缀（外部可见的命名空间）
const MCP_TOOL_PREFIX = 'mulby__'

/** MCP Server 需要的外部依赖 */
export interface MulbyMcpServerDeps {
  /** 获取 app 版本号 */
  getAppVersion: () => string
  /** 插件工具注册中心 */
  pluginToolRegistry: PluginToolRegistry
  /** 插件管理器 */
  pluginManager: PluginManager
  /** 获取用户禁用的插件工具列表 */
  getDisabledPluginTools: () => string[]
}

/** 工具注册条目（用于追踪已注册的工具） */
interface RegisteredToolEntry {
  mcpToolName: string    // MCP 协议中的工具名
  pluginId: string       // 原始插件 ID
  toolName: string       // 插件内的工具名
  pluginName: string     // 插件显示名
  description: string    // 工具描述
  inputSchema: Record<string, unknown>  // JSON Schema
}

/**
 * 构建 MCP 工具名称
 * 格式: mulby__{sanitizedPluginId}__{toolName}
 */
function buildMcpToolName(sanitizedPluginId: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${sanitizedPluginId}__${toolName}`
}

/**
 * 解析 MCP 工具名称（供 stdio bridge 等外部模块使用）
 */
export function parseMcpToolName(name: string): { sanitizedPluginId: string; toolName: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null
  const raw = name.slice(MCP_TOOL_PREFIX.length)
  const sep = raw.indexOf('__')
  if (sep <= 0 || sep >= raw.length - 2) return null
  return {
    sanitizedPluginId: raw.slice(0, sep),
    toolName: raw.slice(sep + 2)
  }
}

/**
 * Mulby MCP Server
 *
 * 管理工具注册表，并为每个 HTTP 请求创建独立的 MCP Server + Transport 对。
 * 这符合 MCP SDK 的无状态模式要求：每个请求使用全新的 transport 实例。
 */
export class MulbyMcpServer {
  private deps: MulbyMcpServerDeps
  // 已注册的工具追踪表（syncTools 时全量重建，所有 per-request Server 共享）
  private registeredTools = new Map<string, RegisteredToolEntry>()

  constructor(deps: MulbyMcpServerDeps) {
    this.deps = deps
  }

  /**
   * 为一个新的 transport 创建并连接一个 MCP Server 实例
   *
   * 每个请求都应该调用此方法创建独立的 Server + Transport 对，
   * 这是 MCP SDK 无状态模式的正确用法。
   *
   * @returns Server 实例（调用方需在请求结束后调用 server.close()）
   */
  async createConnectedServer(transport: Transport): Promise<Server> {
    const server = new Server(
      {
        name: 'Mulby',
        version: this.deps.getAppVersion()
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    // 注册 tools/list handler — 直接返回 JSON Schema，无需 Zod
    // 闭包引用 this.registeredTools，确保所有 Server 实例读取同一份工具表
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Array.from(this.registeredTools.values()).map((entry) => ({
        name: entry.mcpToolName,
        description: `[Mulby:${entry.pluginName}] ${entry.description}`,
        inputSchema: entry.inputSchema
      }))
      return { tools }
    })

    // 注册 tools/call handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments || {}) as Record<string, unknown>
      return await this.handleToolCall(toolName, args)
    })

    await server.connect(transport)
    return server
  }

  /**
   * 同步 PluginToolRegistry 中的所有工具到内部注册表
   *
   * 策略：全量重建（简洁可靠）
   * 因为 per-request Server 的 handler 实时读取 registeredTools，
   * 所以只需要更新 Map 即可，无需调用 SDK 的注册 API。
   */
  syncTools(): void {
    const registry = this.deps.pluginToolRegistry
    const disabledKeys = new Set(this.deps.getDisabledPluginTools())

    // 清空旧注册再重建
    const newTools = new Map<string, RegisteredToolEntry>()

    const aiTools = registry.resolveToolsForAi(disabledKeys)
    for (const aiTool of aiTools) {
      const funcName = aiTool.function?.name
      if (!funcName) continue

      // 解析 plugin_tool__{sanitizedId}__{toolName} 格式
      const PLUGIN_PREFIX = 'plugin_tool__'
      if (!funcName.startsWith(PLUGIN_PREFIX)) continue

      const raw = funcName.slice(PLUGIN_PREFIX.length)
      const sep = raw.indexOf('__')
      if (sep <= 0) continue

      const sanitizedId = raw.slice(0, sep)
      const toolName = raw.slice(sep + 2)
      const pluginId = registry.resolveOriginalPluginId(sanitizedId) || sanitizedId
      const mcpName = buildMcpToolName(sanitizedId, toolName)

      // 从 description 中提取插件名: "[Plugin:XXX] desc" → "XXX"
      const desc = aiTool.function?.description || ''
      const pluginNameMatch = desc.match(/^\[Plugin:(.+?)\]\s*/)
      const pluginName = pluginNameMatch ? pluginNameMatch[1] : pluginId
      const cleanDesc = pluginNameMatch ? desc.slice(pluginNameMatch[0].length) : desc

      newTools.set(mcpName, {
        mcpToolName: mcpName,
        pluginId,
        toolName,
        pluginName,
        description: cleanDesc,
        inputSchema: {
          type: 'object',
          properties: (aiTool.function?.parameters?.properties || {}) as Record<string, unknown>,
          ...(aiTool.function?.parameters?.required ? { required: aiTool.function.parameters.required } : {}),
          ...(aiTool.function?.parameters?.additionalProperties !== undefined
            ? { additionalProperties: aiTool.function.parameters.additionalProperties }
            : {})
        }
      })
    }

    this.registeredTools = newTools

    console.info('[MCP-Server] 工具同步完成', {
      registered: this.registeredTools.size
    })
  }

  /**
   * 处理工具调用
   */
  private async handleToolCall(
    mcpName: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const entry = this.registeredTools.get(mcpName)
    if (!entry) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${mcpName}` }) }],
        isError: true
      }
    }

    // 再次检查是否被禁用
    const disabledKeys = new Set(this.deps.getDisabledPluginTools())
    const toolKey = `${entry.pluginId}:${entry.toolName}`
    if (disabledKeys.has(toolKey)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Tool is disabled: ${toolKey}` }) }],
        isError: true
      }
    }

    try {
      const pluginManager = this.deps.pluginManager
      const plugin = pluginManager.get(entry.pluginId)
      if (!plugin) {
        throw new Error(`Plugin not found: ${entry.pluginId}`)
      }
      if (!plugin.enabled) {
        throw new Error(`Plugin is disabled: ${entry.pluginId}`)
      }

      // 确保插件 host 已初始化
      await pluginManager.initializePlugin(entry.pluginId)
      const hostManager = pluginManager.getHostManager()
      const inited = await hostManager.initPlugin(plugin)
      if (!inited) {
        throw new Error(`Failed to initialize host for plugin: ${entry.pluginId}`)
      }

      // 调用插件工具（与内部 AI 调用完全一致的管道）
      const result = await hostManager.callHostMethod(
        entry.pluginId,
        `__plugin_tool__${entry.toolName}`,
        [args]
      )

      // 解包 host 返回的结果
      let data: unknown = result
      if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
        data = (result as { data: unknown }).data
      }

      // MCP 协议要求返回 content 数组
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      return {
        content: [{ type: 'text', text }]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[MCP-Server] 工具调用失败:', mcpName, message)
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true
      }
    }
  }

  /**
   * 获取已注册工具数量
   */
  getToolCount(): number {
    return this.registeredTools.size
  }

  /**
   * 获取已注册工具列表（用于 UI 展示）
   */
  getRegisteredTools(): Array<{
    mcpToolName: string
    pluginId: string
    toolName: string
    pluginName: string
  }> {
    return Array.from(this.registeredTools.values()).map((e) => ({
      mcpToolName: e.mcpToolName,
      pluginId: e.pluginId,
      toolName: e.toolName,
      pluginName: e.pluginName
    }))
  }

  /**
   * 销毁时清理
   */
  destroy(): void {
    this.registeredTools.clear()
  }
}
