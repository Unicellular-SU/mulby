import type { AiTool } from '../../shared/types/ai'
import type { PluginToolSchema } from '../../shared/types/plugin'
import log from 'electron-log'

// Plugin Tool ID 前缀，与 MCP 的 'mcp__' 保持风格一致
const PLUGIN_TOOL_ID_PREFIX = 'plugin_tool__'

// Tool 名称合法字符正则
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

// AI function name 最大长度限制（OpenAI: 64, Anthropic: 64, Gemini: 无限制）
const MAX_FUNCTION_NAME_LENGTH = 64

// 单个插件注册的工具条目
interface PluginToolEntry {
  pluginId: string        // 原始 pluginId，用于 host 调用
  sanitizedId: string     // 规范化后的 ID，用于 AI function name
  pluginName: string
  schema: PluginToolSchema
  toolId: string          // 全局唯一 ID: plugin_tool__{sanitizedId}__{toolName}
}

/**
 * 将 pluginId 规范化为合法的 AI function name 片段
 * - @scope/name → scope_name
 * - com.example.name → com_example_name
 * - my plugin → my_plugin
 * - 截断超长名称
 */
export function sanitizePluginIdForToolName(pluginId: string): string {
  let sanitized = pluginId
    .replace(/^@/, '')           // 移除开头的 @
    .replace(/[/.@\s]+/g, '_')   // 替换 / . @ 空格为 _
    .replace(/[^a-zA-Z0-9_-]/g, '') // 移除其他非法字符
    .replace(/_+/g, '_')         // 合并连续下划线
    .replace(/^_|_$/g, '')       // 去除首尾下划线

  // 确保不为空
  if (!sanitized) {
    sanitized = 'plugin'
  }

  // 为 toolName 预留空间: prefix(14) + sanitizedId + __(2) + toolName(至少1) = 17 + sanitizedId
  const maxIdLength = MAX_FUNCTION_NAME_LENGTH - PLUGIN_TOOL_ID_PREFIX.length - 2 - 1
  if (sanitized.length > maxIdLength) {
    sanitized = sanitized.slice(0, maxIdLength)
  }

  return sanitized
}

/**
 * 构建 plugin tool 的全局唯一 ID
 * pluginId 会被规范化为合法字符
 */
export function buildPluginToolId(pluginId: string, toolName: string): string {
  const sanitized = sanitizePluginIdForToolName(pluginId)
  const fullName = `${PLUGIN_TOOL_ID_PREFIX}${sanitized}__${toolName}`

  // 最终长度校验，必要时截断 toolName
  if (fullName.length > MAX_FUNCTION_NAME_LENGTH) {
    const availableForTool = MAX_FUNCTION_NAME_LENGTH - PLUGIN_TOOL_ID_PREFIX.length - sanitized.length - 2
    if (availableForTool < 1) {
      // 极端情况：sanitizedId 太长，进一步截断
      const shortenedId = sanitized.slice(0, 20)
      const shortenedTool = toolName.slice(0, MAX_FUNCTION_NAME_LENGTH - PLUGIN_TOOL_ID_PREFIX.length - shortenedId.length - 2)
      return `${PLUGIN_TOOL_ID_PREFIX}${shortenedId}__${shortenedTool}`
    }
    return `${PLUGIN_TOOL_ID_PREFIX}${sanitized}__${toolName.slice(0, availableForTool)}`
  }

  return fullName
}

/**
 * 判断是否为 plugin tool 名称
 */
export function isPluginToolName(name: string): boolean {
  return String(name || '').startsWith(PLUGIN_TOOL_ID_PREFIX)
}

/**
 * 解析 plugin tool ID，提取 sanitizedPluginId 和 toolName
 * 注意：返回的 pluginId 是规范化后的 sanitizedId，
 * 需要通过 PluginToolRegistry.resolveOriginalPluginId() 还原为原始 pluginId
 */
export function parsePluginToolId(toolId: string): { pluginId: string; toolName: string } {
  if (!isPluginToolName(toolId)) {
    throw new Error(`不是有效的 plugin tool ID: ${toolId}`)
  }
  const raw = toolId.slice(PLUGIN_TOOL_ID_PREFIX.length)
  const separatorIndex = raw.indexOf('__')
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 2) {
    throw new Error(`无效的 plugin tool ID 格式: ${toolId}`)
  }
  const pluginId = raw.slice(0, separatorIndex)
  const toolName = raw.slice(separatorIndex + 2)
  return { pluginId, toolName }
}

/**
 * 校验 tool schema 的合法性
 */
function validateToolSchema(schema: PluginToolSchema, pluginId: string): string | null {
  const name = String(schema.name || '').trim()
  if (!name) {
    return `插件 ${pluginId}: tool name 不能为空`
  }
  if (!TOOL_NAME_PATTERN.test(name)) {
    return `插件 ${pluginId}: tool name "${name}" 包含非法字符，仅允许 [a-zA-Z0-9_-]`
  }
  if (!schema.description || !String(schema.description).trim()) {
    return `插件 ${pluginId}: tool "${name}" 的 description 不能为空`
  }
  if (!schema.inputSchema || schema.inputSchema.type !== 'object') {
    return `插件 ${pluginId}: tool "${name}" 的 inputSchema 必须是 { type: 'object', properties: {...} } 格式`
  }
  if (!schema.inputSchema.properties || typeof schema.inputSchema.properties !== 'object') {
    return `插件 ${pluginId}: tool "${name}" 的 inputSchema.properties 必须是对象`
  }
  return null
}

/**
 * Plugin Tools 注册中心
 *
 * 管理所有已加载插件声明的 AI tools，提供:
 * - 注册/注销插件的 tools
 * - 将 plugin tools 转换为 AiTool[] 格式供 AI 合并管道使用
 * - Plugin Tool ID 的生成与解析
 * - sanitizedId → originalPluginId 的逆向映射
 */
export class PluginToolRegistry {
  // pluginId → PluginToolEntry[]
  private registry = new Map<string, PluginToolEntry[]>()
  // sanitizedId → originalPluginId 的逆向映射
  private sanitizedToOriginal = new Map<string, string>()

  /**
   * 注册/刷新插件的 tools（在插件加载时调用）
   */
  refreshPlugin(pluginId: string, pluginName: string, tools: PluginToolSchema[]): void {
    if (!tools || tools.length === 0) {
      this.registry.delete(pluginId)
      // 清理逆向映射
      for (const [sanitized, original] of this.sanitizedToOriginal) {
        if (original === pluginId) {
          this.sanitizedToOriginal.delete(sanitized)
        }
      }
      return
    }

    const sanitizedId = sanitizePluginIdForToolName(pluginId)
    // 注册逆向映射
    this.sanitizedToOriginal.set(sanitizedId, pluginId)

    const entries: PluginToolEntry[] = []
    const seenNames = new Set<string>()

    for (const schema of tools) {
      const error = validateToolSchema(schema, pluginId)
      if (error) {
        log.warn('[PluginTools] 跳过无效的 tool 声明:', error)
        continue
      }

      const name = String(schema.name).trim()
      if (seenNames.has(name)) {
        log.warn(`[PluginTools] 插件 ${pluginId}: tool "${name}" 重复声明，跳过`)
        continue
      }
      seenNames.add(name)

      entries.push({
        pluginId,
        sanitizedId,
        pluginName,
        schema,
        toolId: buildPluginToolId(pluginId, name)
      })
    }

    if (entries.length > 0) {
      this.registry.set(pluginId, entries)
      console.info('[PluginTools] 注册插件工具', {
        pluginId,
        sanitizedId,
        toolCount: entries.length,
        toolNames: entries.map((e) => e.schema.name)
      })
    } else {
      this.registry.delete(pluginId)
    }
  }

  /**
   * 移除插件的所有 tools（在插件卸载时调用）
   */
  removePlugin(pluginId: string): void {
    if (this.registry.delete(pluginId)) {
      // 清理逆向映射
      for (const [sanitized, original] of this.sanitizedToOriginal) {
        if (original === pluginId) {
          this.sanitizedToOriginal.delete(sanitized)
        }
      }
      console.info('[PluginTools] 移除插件工具', { pluginId })
    }
  }

  /**
   * 通过 sanitizedId 还原为原始 pluginId
   * 用于 parsePluginToolId 返回 sanitizedId 后，查找 host 调用所需的原始 pluginId
   */
  resolveOriginalPluginId(sanitizedId: string): string | undefined {
    return this.sanitizedToOriginal.get(sanitizedId)
  }

  /**
   * 获取指定插件的已注册 tools
   */
  getPluginTools(pluginId: string): PluginToolEntry[] {
    return this.registry.get(pluginId) || []
  }

  /**
   * 获取所有已注册的 tools 数量
   */
  getToolCount(): number {
    let count = 0
    for (const entries of this.registry.values()) {
      count += entries.length
    }
    return count
  }

  /**
   * 将所有已注册的 plugin tools 转换为 AiTool[] 格式
   * 供 resolveMergedTools 管道使用
   * @param disabledKeys 用户禁用的工具集合，格式 "pluginId:toolName"
   */
  resolveToolsForAi(disabledKeys?: Set<string>): AiTool[] {
    const tools: AiTool[] = []

    for (const entries of this.registry.values()) {
      for (const entry of entries) {
        // 检查是否被用户禁用
        if (disabledKeys?.has(`${entry.pluginId}:${entry.schema.name}`)) {
          continue
        }
        tools.push({
          type: 'function',
          function: {
            name: entry.toolId,
            description: `[Plugin:${entry.pluginName}] ${entry.schema.description}`,
            parameters: {
              type: 'object',
              properties: entry.schema.inputSchema.properties,
              required: entry.schema.inputSchema.required,
              additionalProperties: entry.schema.inputSchema.additionalProperties
            }
          }
        })
      }
    }

    return tools
  }

  /**
   * 清空所有注册
   */
  clear(): void {
    this.registry.clear()
    this.sanitizedToOriginal.clear()
  }
}
