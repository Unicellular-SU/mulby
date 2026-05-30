import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { aiService } from '../ai'
import { aiMcpService } from '../ai/mcp'
import { aiSkillService } from '../ai/skills'
import { getAiSettings, updateAiSettings } from '../ai/config'
import { resetProviderRegistry } from '../ai/providers'
import { appSettingsManager } from '../services/app-settings'
import { resolveIpcCallerSource, type IpcCallerInfo } from '../services/ipc-caller-resolver'
import type { AiOption, AiMessage, AiImageGenerateProgressChunk, AiMcpServer } from '../../shared/types/ai'
import type { AiToolWebSearchSettings } from '../../shared/types/settings'
import type { PluginPermissions } from '../../shared/types/plugin'

/** AI IPC handlers 的可选回调钩子 */
export interface AiHandlersHooks {
  /** 当 disabledPluginTools 变更时触发（用于 MCP Server 工具列表刷新） */
  onDisabledPluginToolsChanged?: () => void
}

interface AiPluginLookupResult {
  manifest: {
    type?: string
    permissions?: PluginPermissions
  }
}

let pluginLookup: ((pluginId: string) => AiPluginLookupResult | undefined) | null = null

export function setAiPluginLookup(
  lookup: (pluginId: string) => AiPluginLookupResult | undefined
): void {
  pluginLookup = lookup
}

export function optionWithCallerIdentity(option: AiOption, caller: IpcCallerInfo): AiOption {
  if (caller.source === 'untrusted') {
    throw new Error('拒绝未知窗口调用 AI 能力')
  }

  const plugin = caller.source === 'plugin' && caller.pluginId
    ? pluginLookup?.(caller.pluginId)
    : undefined
  const callerIdentity = caller.source === 'plugin' && caller.pluginId
    ? {
        kind: 'ai' as const,
        host: 'plugin' as const,
        actor: 'ai' as const,
        pluginId: caller.pluginId,
        pluginType: plugin?.manifest.type
      }
    : {
        kind: 'ai' as const,
        host: 'app' as const,
        actor: 'ai' as const
      }

  return {
    ...option,
    toolContext: {
      ...option.toolContext,
      pluginName: caller.source === 'plugin' && caller.pluginId ? caller.pluginId : undefined,
      caller: callerIdentity
    }
  }
}

function ensureAiSystemWindowCaller(event: IpcMainInvokeEvent, channel: string): void {
  const caller = resolveIpcCallerSource(event.sender)
  if (caller.source !== 'app') {
    throw new Error(`[AI] Access denied: '${channel}' is a system-only API`)
  }
}

function ensureAiAttachmentUploadAllowed(event: IpcMainInvokeEvent, input: { filePath?: string }): void {
  if (!String(input?.filePath || '').trim()) return
  ensureAiSystemWindowCaller(event, 'ai:attachments:upload')
}

export function registerAiHandlers(hooks?: AiHandlersHooks) {
  ipcMain.handle('ai:call', async (event: IpcMainInvokeEvent, option: AiOption) => {
    const caller = resolveIpcCallerSource(event.sender)
    return await aiService.call(optionWithCallerIdentity(option, caller))
  })

  ipcMain.handle('ai:stream', async (event: IpcMainInvokeEvent, option: AiOption) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let scopedOption: AiOption
    try {
      const caller = resolveIpcCallerSource(event.sender)
      scopedOption = optionWithCallerIdentity(option, caller)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'AI stream rejected')
      throw new Error(message)
    }

    // 避免在 renderer 监听器挂载前发送首个 chunk/end，导致 Promise 永久等待。
    setTimeout(() => {
      let settled = false
      aiService
        .stream(scopedOption, {
          onChunk: (chunk: AiMessage) => {
            event.sender.send('ai:stream:chunk', requestId, chunk)
          },
          onEnd: (message: AiMessage) => {
            settled = true
            event.sender.send('ai:stream:end', requestId, message)
          },
          onError: (error: Error) => {
            settled = true
            event.sender.send('ai:stream:error', requestId, error.message)
          }
        }, requestId)
        .catch((error) => {
          // 双重兜底：若异常发生在 aiService.stream 的 onError 触发之前，也要回传给 renderer。
          if (settled) return
          const message = error instanceof Error ? error.message : String(error || 'AI stream failed')
          event.sender.send('ai:stream:error', requestId, message)
        })
    }, 0)

    return { requestId }
  })

  ipcMain.handle('ai:abort', async (_event: IpcMainInvokeEvent, requestId: string) => {
    console.info('[AI] IPC ai:abort received', { requestId })
    aiService.abort(requestId)
  })

  ipcMain.handle('ai:models:all', async () => {
    return aiService.allModels()
  })

  ipcMain.handle('ai:models:fetch', async (event: IpcMainInvokeEvent, input) => {
    ensureAiSystemWindowCaller(event, 'ai:models:fetch')
    return await aiService.fetchModels(input)
  })

  ipcMain.handle('ai:test', async (event: IpcMainInvokeEvent, input) => {
    ensureAiSystemWindowCaller(event, 'ai:test')
    return await aiService.testConnection(input)
  })

  ipcMain.handle('ai:test:stream', async (event, input) => {
    ensureAiSystemWindowCaller(event, 'ai:test:stream')
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setTimeout(() => {
      aiService
        .testConnectionStream(input, (chunk) => {
          event.sender.send('ai:test:chunk', requestId, chunk)
        })
        .then((result) => {
          event.sender.send('ai:test:end', requestId, result)
        })
        .catch((err: Error) => {
          event.sender.send('ai:test:error', requestId, err.message)
        })
    }, 0)
    return { requestId }
  })

  ipcMain.handle('ai:settings:get', async (event: IpcMainInvokeEvent) => {
    ensureAiSystemWindowCaller(event, 'ai:settings:get')
    return getAiSettings()
  })

  ipcMain.handle('ai:settings:update', async (event: IpcMainInvokeEvent, partial) => {
    ensureAiSystemWindowCaller(event, 'ai:settings:update')
    const next = updateAiSettings(partial)
    resetProviderRegistry()
    return next
  })

  ipcMain.handle('ai:mcp:servers:list', async (event: IpcMainInvokeEvent) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:servers:list')
    return aiMcpService.listServers()
  })

  ipcMain.handle('ai:mcp:servers:get', async (event: IpcMainInvokeEvent, serverId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:servers:get')
    return aiMcpService.getServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:upsert', async (event: IpcMainInvokeEvent, server: AiMcpServer) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:servers:upsert')
    return aiMcpService.upsertServer(server)
  })

  ipcMain.handle('ai:mcp:servers:remove', async (event: IpcMainInvokeEvent, serverId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:servers:remove')
    await aiMcpService.removeServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:activate', async (event: IpcMainInvokeEvent, serverId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:servers:activate')
    return await aiMcpService.activateServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:deactivate', async (event: IpcMainInvokeEvent, serverId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:servers:deactivate')
    return await aiMcpService.deactivateServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:restart', async (event: IpcMainInvokeEvent, serverId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:servers:restart')
    return await aiMcpService.restartServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:check', async (event: IpcMainInvokeEvent, serverId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:servers:check')
    return await aiMcpService.checkServerConnectivity(serverId)
  })

  ipcMain.handle('ai:mcp:tools:list', async (event: IpcMainInvokeEvent, serverId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:tools:list')
    return await aiMcpService.listTools(serverId)
  })

  ipcMain.handle('ai:mcp:abort', async (event: IpcMainInvokeEvent, callId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:abort')
    return aiMcpService.abortTool(callId)
  })

  ipcMain.handle('ai:mcp:logs:get', async (event: IpcMainInvokeEvent, serverId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:mcp:logs:get')
    return aiMcpService.getLogs(serverId)
  })

  ipcMain.handle('ai:skills:list', async (event: IpcMainInvokeEvent) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:list')
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.list()
  })

  ipcMain.handle('ai:skills:refresh', async (event: IpcMainInvokeEvent) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:refresh')
    return await aiSkillService.refreshCatalog()
  })

  ipcMain.handle('ai:skills:list-enabled', async (event: IpcMainInvokeEvent) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:list-enabled')
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.listEnabled()
  })

  ipcMain.handle('ai:skills:get', async (event: IpcMainInvokeEvent, skillId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:get')
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.get(skillId)
  })

  ipcMain.handle('ai:skills:install', async (event: IpcMainInvokeEvent, input) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:install')
    const installed = await aiSkillService.install(input)
    await aiSkillService.refreshCatalog()
    return installed
  })

  ipcMain.handle('ai:skills:remove', async (event: IpcMainInvokeEvent, skillId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:remove')
    await aiSkillService.ensureCatalogLoaded()
    await aiSkillService.remove(skillId)
    await aiSkillService.refreshCatalog()
  })

  ipcMain.handle('ai:skills:enable', async (event: IpcMainInvokeEvent, skillId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:enable')
    await aiSkillService.ensureCatalogLoaded()
    return await aiSkillService.enable(skillId)
  })

  ipcMain.handle('ai:skills:disable', async (event: IpcMainInvokeEvent, skillId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:disable')
    await aiSkillService.ensureCatalogLoaded()
    return await aiSkillService.disable(skillId)
  })

  ipcMain.handle('ai:skills:preview', async (event: IpcMainInvokeEvent, input) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:preview')
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.preview(input)
  })

  ipcMain.handle('ai:skills:resolve', async (event: IpcMainInvokeEvent, option: AiOption) => {
    ensureAiSystemWindowCaller(event, 'ai:skills:resolve')
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.resolveForAiCall(option)
  })

  ipcMain.handle('ai:attachments:upload', async (event: IpcMainInvokeEvent, input) => {
    ensureAiAttachmentUploadAllowed(event, input)
    return await aiService.uploadAttachment(input)
  })

  ipcMain.handle('ai:attachments:get', async (_event, attachmentId: string) => {
    return await aiService.getAttachment(attachmentId)
  })

  ipcMain.handle('ai:attachments:delete', async (_event, attachmentId: string) => {
    return await aiService.deleteAttachment(attachmentId)
  })

  ipcMain.handle('ai:attachments:upload-provider', async (_event, input) => {
    return await aiService.uploadAttachmentToProvider(input)
  })

  ipcMain.handle('ai:tokens:estimate', async (_event, input) => {
    return await aiService.estimateTokens(input)
  })

  ipcMain.handle('ai:images:generate', async (_event, input) => {
    return await aiService.generateImages(input)
  })

  ipcMain.handle('ai:images:generate:stream', async (event, input) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setTimeout(() => {
      aiService
        .generateImagesStream(
          input,
          (chunk: AiImageGenerateProgressChunk) => {
            console.info('[AI] image:stream:chunk', {
              requestId,
              type: chunk.type,
              stage: chunk.stage,
              received: chunk.received,
              total: chunk.total,
              hasImage: Boolean(chunk.image)
            })
            event.sender.send('ai:images:chunk', requestId, chunk)
          },
          requestId
        )
        .then((result) => {
          event.sender.send('ai:images:end', requestId, result)
        })
        .catch((err: Error) => {
          event.sender.send('ai:images:error', requestId, err.message)
        })
    }, 0)
    return { requestId }
  })

  ipcMain.handle('ai:images:edit', async (_event, input) => {
    return await aiService.editImage(input)
  })

  // ---- AI 工具设置（webSearch）----

  ipcMain.handle('ai:tooling:webSearch:get', async (event: IpcMainInvokeEvent) => {
    ensureAiSystemWindowCaller(event, 'ai:tooling:webSearch:get')
    return appSettingsManager.getSettings().aiTooling.webSearch
  })

  ipcMain.handle('ai:tooling:webSearch:update', async (event: IpcMainInvokeEvent, partial: Partial<AiToolWebSearchSettings>) => {
    ensureAiSystemWindowCaller(event, 'ai:tooling:webSearch:update')
    const current = appSettingsManager.getSettings()
    const merged: AiToolWebSearchSettings = {
      ...current.aiTooling.webSearch,
      ...partial,
      providerKeys: {
        ...current.aiTooling.webSearch.providerKeys,
        ...(partial.providerKeys || {})
      }
    }
    const next = appSettingsManager.updateSettings({
      aiTooling: {
        ...current.aiTooling,
        webSearch: merged
      }
    })
    return next.aiTooling.webSearch
  })

  // 插件 API：获取结构化的搜索设置（含 provider 列表）
  ipcMain.handle('ai:tooling:webSearch:getSettings', async (event: IpcMainInvokeEvent) => {
    ensureAiSystemWindowCaller(event, 'ai:tooling:webSearch:getSettings')
    const settings = appSettingsManager.getSettings().aiTooling.webSearch
    const providers: Array<{ id: string; name: string; type: 'local' | 'api' | 'custom' }> = []

    // 本地引擎
    for (const engine of settings.localEngines || []) {
      providers.push({ id: engine.id, name: engine.name, type: 'local' })
    }
    // 内置 API Provider — 无论 key 是否已配置都列出，用户可先选 provider 再填 key
    providers.push({ id: 'tavily', name: 'Tavily', type: 'api' })
    providers.push({ id: 'jina', name: 'Jina', type: 'api' })
    // 自定义 API
    for (const api of settings.customApis || []) {
      providers.push({ id: `custom-${api.id}`, name: api.name, type: 'custom' })
    }

    return {
      activeProvider: settings.activeProvider,
      providers
    }
  })

  // 插件 API：切换搜索 provider
  ipcMain.handle('ai:tooling:webSearch:setActiveProvider', async (event: IpcMainInvokeEvent, providerId: string) => {
    ensureAiSystemWindowCaller(event, 'ai:tooling:webSearch:setActiveProvider')
    const current = appSettingsManager.getSettings()
    const webSearch = current.aiTooling.webSearch

    // 校验 providerId 是否合法 — tavily/jina 始终有效
    const allProviderIds = new Set([
      ...(webSearch.localEngines || []).map((e) => e.id),
      'tavily',
      'jina',
      ...(webSearch.customApis || []).map((a) => `custom-${a.id}`)
    ])
    const normalizedId = String(providerId || '').trim()
    if (!normalizedId || !allProviderIds.has(normalizedId)) {
      return { success: false, activeProvider: webSearch.activeProvider }
    }

    const next = appSettingsManager.updateSettings({
      aiTooling: {
        ...current.aiTooling,
        webSearch: {
          ...webSearch,
          activeProvider: normalizedId
        }
      }
    })
    return { success: true, activeProvider: next.aiTooling.webSearch.activeProvider }
  })

  // ---- 插件工具禁用管理 ----

  ipcMain.handle('ai:tooling:pluginTools:getDisabled', async (event: IpcMainInvokeEvent) => {
    ensureAiSystemWindowCaller(event, 'ai:tooling:pluginTools:getDisabled')
    return appSettingsManager.getSettings().aiTooling.disabledPluginTools || []
  })

  ipcMain.handle('ai:tooling:pluginTools:setDisabled', async (event: IpcMainInvokeEvent, disabledList: string[]) => {
    ensureAiSystemWindowCaller(event, 'ai:tooling:pluginTools:setDisabled')
    const current = appSettingsManager.getSettings()
    const next = appSettingsManager.updateSettings({
      aiTooling: {
        ...current.aiTooling,
        disabledPluginTools: disabledList
      }
    })
    // 通知外部（MCP Server 等）工具可见性变更
    hooks?.onDisabledPluginToolsChanged?.()
    return next.aiTooling.disabledPluginTools || []
  })
}
