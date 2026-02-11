import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  LoggingMessageNotificationSchema,
  ToolListChangedNotificationSchema,
  type Tool as SdkTool
} from '@modelcontextprotocol/sdk/types.js'
import type {
  AiMcpSelection,
  AiMcpServer,
  AiMcpServerLogEntry,
  AiMcpTool,
  AiSettings,
  AiTool,
  AiToolContext
} from '../../../shared/types/ai'
import { getAiSettings, updateAiSettings } from '../config'

const TOOL_ID_PREFIX = 'mcp__'
const TOOL_LIST_CACHE_TTL_MS = 5 * 60 * 1000

interface CachedTools {
  expiresAt: number
  tools: AiMcpTool[]
}

interface AiMcpServiceDeps {
  getSettings: () => AiSettings
  updateSettings: (partial: Partial<AiSettings>) => AiSettings
  getAppVersion: () => string
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function normalizeToolSchema(input: unknown): { type: 'object'; properties: Record<string, unknown>; required?: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { type: 'object', properties: {} }
  }
  const candidate = input as Record<string, unknown>
  const propertiesRaw = candidate.properties
  const requiredRaw = candidate.required
  const properties =
    propertiesRaw && typeof propertiesRaw === 'object' && !Array.isArray(propertiesRaw)
      ? (propertiesRaw as Record<string, unknown>)
      : {}
  const required = Array.isArray(requiredRaw)
    ? requiredRaw.map((item) => String(item)).filter(Boolean)
    : undefined
  return {
    type: 'object',
    properties,
    required: required && required.length > 0 ? required : undefined
  }
}

function normalizeRecord(input?: Record<string, string>): Record<string, string> | undefined {
  if (!input) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    const nextKey = String(key || '').trim()
    if (!nextKey) continue
    out[nextKey] = String(value ?? '')
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeServerType(type?: string): 'stdio' | 'sse' | 'streamableHttp' {
  if (type === 'sse' || type === 'streamableHttp') return type
  return 'stdio'
}

function getProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }
  return env
}

function normalizeServer(input: AiMcpServer): AiMcpServer {
  return {
    ...input,
    id: String(input.id || '').trim(),
    name: String(input.name || '').trim(),
    type: normalizeServerType(input.type),
    baseUrl: String(input.baseUrl || '').trim() || undefined,
    command: String(input.command || '').trim() || undefined,
    args: Array.isArray(input.args) ? input.args.map((item) => String(item)).filter(Boolean) : undefined,
    env: normalizeRecord(input.env),
    headers: normalizeRecord(input.headers),
    isActive: !!input.isActive,
    installSource: input.installSource,
    isTrusted: input.isTrusted,
    trustedAt: input.trustedAt,
    installedAt: input.installedAt,
    timeoutSec: typeof input.timeoutSec === 'number' && Number.isFinite(input.timeoutSec) && input.timeoutSec > 0
      ? Math.floor(input.timeoutSec)
      : undefined,
    longRunning: !!input.longRunning,
    disabledTools: Array.isArray(input.disabledTools) ? input.disabledTools.map((item) => String(item)).filter(Boolean) : undefined,
    disabledAutoApproveTools: Array.isArray(input.disabledAutoApproveTools)
      ? input.disabledAutoApproveTools.map((item) => String(item)).filter(Boolean)
      : undefined
  }
}

function getDefaultTimeoutMs(server: AiMcpServer, settings: AiSettings): number {
  const mcpSettings = settings.mcp
  const fallback = mcpSettings?.defaults?.timeoutMs ?? 60000
  return (server.timeoutSec ?? Math.max(Math.floor(fallback / 1000), 1)) * 1000
}

function getLongRunningMaxMs(settings: AiSettings): number {
  return settings.mcp?.defaults?.longRunningMaxMs ?? 10 * 60 * 1000
}

function isProtocolServerUntrusted(server: AiMcpServer): boolean {
  return server.installSource === 'protocol' && server.isTrusted !== true
}

function isAllowedByList(candidate: string, allowList?: string[]): boolean {
  if (!allowList || allowList.length === 0) return true
  return allowList.includes(candidate)
}

export function buildMcpToolId(serverId: string, toolName: string): string {
  return `${TOOL_ID_PREFIX}${serverId}__${toolName}`
}

export function isMcpToolName(name: string): boolean {
  return String(name || '').startsWith(TOOL_ID_PREFIX)
}

function parseMcpToolId(toolId: string): { serverId: string; toolName: string } {
  if (!isMcpToolName(toolId)) {
    throw new Error(`Not an MCP tool id: ${toolId}`)
  }
  const raw = toolId.slice(TOOL_ID_PREFIX.length)
  const separatorIndex = raw.indexOf('__')
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 2) {
    throw new Error(`Invalid MCP tool id: ${toolId}`)
  }
  const serverId = raw.slice(0, separatorIndex)
  const toolName = raw.slice(separatorIndex + 2)
  return { serverId, toolName }
}

export class AiMcpService {
  private deps: AiMcpServiceDeps
  private clients = new Map<string, Client>()
  private pendingClients = new Map<string, Promise<Client>>()
  private toolCache = new Map<string, CachedTools>()
  private activeToolCalls = new Map<string, AbortController>()
  private logStore = new Map<string, AiMcpServerLogEntry[]>()

  constructor(deps?: Partial<AiMcpServiceDeps>) {
    this.deps = {
      getSettings: deps?.getSettings || getAiSettings,
      updateSettings: deps?.updateSettings || updateAiSettings,
      getAppVersion: deps?.getAppVersion || (() => app.getVersion())
    }
  }

  listServers(): AiMcpServer[] {
    return [...(this.deps.getSettings().mcp?.servers || [])]
  }

  getServer(serverId: string): AiMcpServer | null {
    const id = String(serverId || '').trim()
    if (!id) return null
    return this.listServers().find((item) => item.id === id) || null
  }

  upsertServer(server: AiMcpServer): AiMcpServer {
    const normalized = normalizeServer(server)
    if (!normalized.id) {
      throw new Error('MCP server id is required')
    }
    if (!normalized.name) {
      throw new Error('MCP server name is required')
    }

    const now = Date.now()
    const current = this.getServer(normalized.id)
    const nextServer: AiMcpServer = current
      ? {
          ...current,
          ...normalized
        }
      : {
          ...normalized,
          installSource: normalized.installSource || 'manual',
          installedAt: normalized.installedAt || now,
          isTrusted: normalized.isTrusted ?? true,
          trustedAt: normalized.isTrusted === false ? normalized.trustedAt : (normalized.trustedAt || now)
        }

    const settings = this.deps.getSettings().mcp
    const servers = [...(settings?.servers || [])]
    const index = servers.findIndex((item) => item.id === nextServer.id)
    if (index >= 0) {
      servers[index] = nextServer
    } else {
      servers.unshift(nextServer)
    }

    const updated = this.deps.updateSettings({
      mcp: {
        ...(settings || { servers: [] }),
        servers
      }
    })

    this.invalidateServerCaches(nextServer.id)

    return (updated.mcp?.servers || []).find((item) => item.id === nextServer.id) || nextServer
  }

  async removeServer(serverId: string): Promise<void> {
    const id = String(serverId || '').trim()
    if (!id) return
    await this.closeClient(id)

    const settings = this.deps.getSettings().mcp
    const servers = (settings?.servers || []).filter((item) => item.id !== id)
    this.deps.updateSettings({
      mcp: {
        ...(settings || { servers: [] }),
        servers
      }
    })

    this.invalidateServerCaches(id)
    this.logStore.delete(id)
  }

  async activateServer(serverId: string): Promise<AiMcpServer> {
    const server = this.requireServer(serverId)
    this.assertServerTrusted(server)
    await this.initClient({ ...server, isActive: true })
    return this.upsertServer({ ...server, isActive: true })
  }

  async deactivateServer(serverId: string): Promise<AiMcpServer> {
    const server = this.requireServer(serverId)
    await this.closeClient(server.id)
    return this.upsertServer({ ...server, isActive: false })
  }

  async restartServer(serverId: string): Promise<AiMcpServer> {
    const server = this.requireServer(serverId)
    await this.closeClient(server.id)
    this.invalidateServerCaches(server.id)
    this.assertServerTrusted(server)
    await this.initClient({ ...server, isActive: true })
    return this.upsertServer({ ...server, isActive: true })
  }

  async checkServerConnectivity(serverId: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const server = this.requireServer(serverId)
      this.assertServerTrusted(server)
      const client = await this.initClient({ ...server, isActive: true })
      await client.listTools()
      this.appendLog(server.id, {
        level: 'info',
        message: 'Connectivity check succeeded',
        source: 'connectivity'
      })
      return { ok: true }
    } catch (error) {
      const message = stringifyError(error)
      this.appendLog(serverId, {
        level: 'error',
        message: `Connectivity check failed: ${message}`,
        source: 'connectivity'
      })
      return { ok: false, message }
    }
  }

  async listTools(serverId: string, context?: AiToolContext): Promise<AiMcpTool[]> {
    const server = this.requireServer(serverId)
    this.assertServerUsable(server)

    const now = Date.now()
    const cached = this.toolCache.get(server.id)
    if (cached && cached.expiresAt > now) {
      return this.applyToolPolicies(server, cached.tools, context)
    }

    const client = await this.initClient(server)
    const result = await client.listTools()
    const tools = (result.tools || []).map((tool) => this.toMcpTool(server, tool))
    this.toolCache.set(server.id, {
      expiresAt: now + TOOL_LIST_CACHE_TTL_MS,
      tools
    })

    return this.applyToolPolicies(server, tools, context)
  }

  async resolveToolsForAi(input: {
    selection?: AiMcpSelection
    context?: AiToolContext
  }): Promise<AiTool[]> {
    const mode = input.selection?.mode || 'off'
    if (mode === 'off') return []

    const settings = this.deps.getSettings().mcp
    const servers = (settings?.servers || []).filter((server) => server.isActive)

    let selectedServers = servers
    if (Array.isArray(input.selection?.serverIds) && input.selection.serverIds.length > 0) {
      const include = new Set(input.selection.serverIds)
      selectedServers = selectedServers.filter((server) => include.has(server.id))
    }

    const scopedServerIds = input.context?.mcpScope?.allowedServerIds
    if (Array.isArray(scopedServerIds) && scopedServerIds.length > 0) {
      const include = new Set(scopedServerIds)
      selectedServers = selectedServers.filter((server) => include.has(server.id))
    }

    const optionAllowList = input.selection?.allowedToolIds
    const scopeAllowList = input.context?.mcpScope?.allowedToolIds

    const aiTools: AiTool[] = []
    for (const server of selectedServers) {
      if (isProtocolServerUntrusted(server)) {
        this.appendLog(server.id, {
          level: 'warn',
          message: `Skip untrusted protocol server: ${server.name}`,
          source: 'policy'
        })
        continue
      }
      const tools = await this.listTools(server.id, input.context)
      for (const tool of tools) {
        if (!isAllowedByList(tool.id, optionAllowList) && !isAllowedByList(tool.name, optionAllowList)) {
          continue
        }
        if (!isAllowedByList(tool.id, scopeAllowList) && !isAllowedByList(tool.name, scopeAllowList)) {
          continue
        }

        aiTools.push({
          type: 'function',
          function: {
            name: tool.id,
            description: tool.description || `[MCP:${tool.serverName}] ${tool.name}`,
            parameters: normalizeToolSchema(tool.inputSchema)
          }
        })
      }
    }

    return aiTools
  }

  async callToolById(input: {
    toolId: string
    args: unknown
    context?: AiToolContext
    callId?: string
  }): Promise<unknown> {
    const { serverId, toolName } = parseMcpToolId(input.toolId)
    return await this.callTool({
      serverId,
      toolName,
      args: input.args,
      context: input.context,
      callId: input.callId
    })
  }

  async callTool(input: {
    serverId: string
    toolName: string
    args: unknown
    context?: AiToolContext
    callId?: string
  }): Promise<unknown> {
    const server = this.requireServer(input.serverId)
    this.assertServerUsable(server)
    this.assertToolAllowed(server, input.toolName, input.context)

    const toolId = buildMcpToolId(server.id, input.toolName)
    const callId = input.callId || randomUUID()
    const controller = new AbortController()
    this.activeToolCalls.set(callId, controller)

    const settings = this.deps.getSettings()
    const timeoutMs = getDefaultTimeoutMs(server, settings)
    const maxTotalTimeout = server.longRunning ? getLongRunningMaxMs(settings) : undefined

    this.appendLog(server.id, {
      level: 'info',
      message: `Calling tool ${input.toolName}`,
      source: 'tool',
      data: { toolId, callId }
    })

    try {
      const client = await this.initClient(server)
      const args =
        input.args && typeof input.args === 'object' && !Array.isArray(input.args)
          ? (input.args as Record<string, unknown>)
          : {}
      const result = await client.callTool(
        {
          name: input.toolName,
          arguments: args
        },
        undefined,
        {
          timeout: timeoutMs,
          resetTimeoutOnProgress: !!server.longRunning,
          maxTotalTimeout,
          signal: controller.signal,
          onprogress: (progress) => {
            this.appendLog(server.id, {
              level: 'debug',
              message: `Tool progress ${input.toolName}`,
              source: 'progress',
              data: {
                callId,
                progress: progress.progress,
                total: progress.total
              }
            })
          }
        }
      )
      this.appendLog(server.id, {
        level: 'info',
        message: `Tool call completed ${input.toolName}`,
        source: 'tool',
        data: { callId }
      })
      return result
    } catch (error) {
      this.appendLog(server.id, {
        level: 'error',
        message: `Tool call failed ${input.toolName}: ${stringifyError(error)}`,
        source: 'tool',
        data: { callId }
      })
      throw error
    } finally {
      this.activeToolCalls.delete(callId)
    }
  }

  abortTool(callId: string): boolean {
    const id = String(callId || '').trim()
    if (!id) return false
    const controller = this.activeToolCalls.get(id)
    if (!controller) return false
    controller.abort()
    this.activeToolCalls.delete(id)
    return true
  }

  getLogs(serverId: string): AiMcpServerLogEntry[] {
    const id = String(serverId || '').trim()
    if (!id) return []
    return [...(this.logStore.get(id) || [])]
  }

  async cleanup(): Promise<void> {
    const closeJobs = [...this.clients.keys()].map((serverId) => this.closeClient(serverId))
    await Promise.allSettled(closeJobs)
  }

  private toMcpTool(server: AiMcpServer, tool: SdkTool): AiMcpTool {
    return {
      id: buildMcpToolId(server.id, tool.name),
      name: tool.name,
      description: tool.description,
      serverId: server.id,
      serverName: server.name,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema
    }
  }

  private applyToolPolicies(server: AiMcpServer, tools: AiMcpTool[], context?: AiToolContext): AiMcpTool[] {
    const disabled = new Set(server.disabledTools || [])
    const allowedToolIds = context?.mcpScope?.allowedToolIds

    return tools.filter((tool) => {
      if (disabled.has(tool.name)) return false
      if (!allowedToolIds || allowedToolIds.length === 0) return true
      return allowedToolIds.includes(tool.id) || allowedToolIds.includes(tool.name)
    })
  }

  private assertServerTrusted(server: AiMcpServer): void {
    if (isProtocolServerUntrusted(server)) {
      throw new Error(`MCP server ${server.name} is not trusted`)
    }
  }

  private assertServerUsable(server: AiMcpServer): void {
    this.assertServerTrusted(server)
    if (!server.isActive) {
      throw new Error(`MCP server ${server.name} is not active`)
    }
  }

  private assertToolAllowed(server: AiMcpServer, toolName: string, context?: AiToolContext): void {
    const disabled = new Set(server.disabledTools || [])
    if (disabled.has(toolName)) {
      throw new Error(`MCP tool ${toolName} is disabled on server ${server.name}`)
    }

    const scope = context?.mcpScope
    if (scope?.allowedServerIds && scope.allowedServerIds.length > 0 && !scope.allowedServerIds.includes(server.id)) {
      throw new Error(`MCP server ${server.name} is not allowed in current scope`)
    }

    const toolId = buildMcpToolId(server.id, toolName)
    if (scope?.allowedToolIds && scope.allowedToolIds.length > 0) {
      if (!scope.allowedToolIds.includes(toolName) && !scope.allowedToolIds.includes(toolId)) {
        throw new Error(`MCP tool ${toolName} is not allowed in current scope`)
      }
    }
  }

  private requireServer(serverId: string): AiMcpServer {
    const server = this.getServer(serverId)
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`)
    }
    return server
  }

  private invalidateServerCaches(serverId: string): void {
    this.toolCache.delete(serverId)
  }

  private appendLog(serverId: string, entry: Omit<AiMcpServerLogEntry, 'timestamp'>): void {
    const id = String(serverId || '').trim()
    if (!id) return
    const list = this.logStore.get(id) || []
    list.push({
      timestamp: Date.now(),
      ...entry
    })
    if (list.length > 500) {
      list.splice(0, list.length - 500)
    }
    this.logStore.set(id, list)
  }

  private async initClient(serverInput: AiMcpServer): Promise<Client> {
    const server = normalizeServer(serverInput)
    const serverId = server.id

    const pending = this.pendingClients.get(serverId)
    if (pending) {
      return pending
    }

    const existing = this.clients.get(serverId)
    if (existing) {
      try {
        await existing.ping({ timeout: 1000 })
        return existing
      } catch {
        await this.closeClient(serverId)
      }
    }

    const initPromise = (async () => {
      const client = new Client(
        {
          name: 'Mulby',
          version: this.deps.getAppVersion()
        },
        {
          capabilities: {}
        }
      )

      try {
        const transport = this.createTransport(server)
        await client.connect(transport)

        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          this.invalidateServerCaches(serverId)
          this.appendLog(serverId, {
            level: 'debug',
            message: 'Tool list changed notification received',
            source: 'notification'
          })
        })

        client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
          const levelRaw = String(notification.params?.level || 'info').toLowerCase()
          const level: AiMcpServerLogEntry['level'] =
            levelRaw === 'debug' || levelRaw === 'warn' || levelRaw === 'error' ? levelRaw : 'info'
          const message =
            typeof notification.params?.data === 'string'
              ? notification.params.data
              : JSON.stringify(notification.params?.data ?? '')
          this.appendLog(serverId, {
            level,
            message,
            source: typeof notification.params?.logger === 'string' ? notification.params.logger : 'server',
            data: notification.params?.data
          })
        })

        this.clients.set(serverId, client)
        this.appendLog(serverId, {
          level: 'info',
          message: 'MCP server connected',
          source: 'client'
        })

        return client
      } catch (error) {
        this.appendLog(serverId, {
          level: 'error',
          message: `Failed to initialize MCP client: ${stringifyError(error)}`,
          source: 'client'
        })
        throw error
      } finally {
        this.pendingClients.delete(serverId)
      }
    })()

    this.pendingClients.set(serverId, initPromise)

    return await initPromise
  }

  private createTransport(server: AiMcpServer) {
    if (server.type === 'streamableHttp') {
      if (!server.baseUrl) {
        throw new Error(`MCP server ${server.name} missing baseUrl`)
      }
      return new StreamableHTTPClientTransport(new URL(server.baseUrl), {
        requestInit: {
          headers: server.headers
        }
      })
    }

    if (server.type === 'sse') {
      if (!server.baseUrl) {
        throw new Error(`MCP server ${server.name} missing baseUrl`)
      }
      return new SSEClientTransport(new URL(server.baseUrl), {
        requestInit: {
          headers: server.headers
        }
      })
    }

    if (!server.command) {
      throw new Error(`MCP stdio server ${server.name} missing command`)
    }

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: {
        ...getProcessEnv(),
        ...(server.env || {})
      },
      stderr: 'pipe'
    })

    transport.stderr?.on('data', (chunk) => {
      const message = String(chunk || '').trim()
      if (!message) return
      this.appendLog(server.id, {
        level: 'warn',
        message,
        source: 'stdio'
      })
    })

    return transport
  }

  private async closeClient(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (!client) return
    this.clients.delete(serverId)
    try {
      await client.close()
    } catch {
      // ignore close errors
    }
  }
}

export const aiMcpService = new AiMcpService()
