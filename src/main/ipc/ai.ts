import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { aiService } from '../ai'
import { aiMcpService } from '../ai/mcp'
import { aiSkillService } from '../ai/skills'
import { getAiSettings, updateAiSettings } from '../ai/config'
import { resetProviderRegistry } from '../ai/providers'
import { appSettingsManager } from '../services/app-settings'
import type { AiOption, AiMessage, AiImageGenerateProgressChunk, AiMcpServer } from '../../shared/types/ai'
import type { AiToolWebSearchSettings } from '../../shared/types/settings'

export function registerAiHandlers() {
  ipcMain.handle('ai:call', async (_event: IpcMainInvokeEvent, option: AiOption) => {
    return await aiService.call(option)
  })

  ipcMain.handle('ai:stream', async (event: IpcMainInvokeEvent, option: AiOption) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // 避免在 renderer 监听器挂载前发送首个 chunk/end，导致 Promise 永久等待。
    setTimeout(() => {
      let settled = false
      aiService
        .stream(option, {
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

  ipcMain.handle('ai:models:fetch', async (_event, input) => {
    return await aiService.fetchModels(input)
  })

  ipcMain.handle('ai:test', async (_event, input) => {
    return await aiService.testConnection(input)
  })

  ipcMain.handle('ai:test:stream', async (event, input) => {
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

  ipcMain.handle('ai:settings:get', async () => {
    return getAiSettings()
  })

  ipcMain.handle('ai:settings:update', async (_event, partial) => {
    const next = updateAiSettings(partial)
    resetProviderRegistry()
    return next
  })

  ipcMain.handle('ai:mcp:servers:list', async () => {
    return aiMcpService.listServers()
  })

  ipcMain.handle('ai:mcp:servers:get', async (_event, serverId: string) => {
    return aiMcpService.getServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:upsert', async (_event, server: AiMcpServer) => {
    return aiMcpService.upsertServer(server)
  })

  ipcMain.handle('ai:mcp:servers:remove', async (_event, serverId: string) => {
    await aiMcpService.removeServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:activate', async (_event, serverId: string) => {
    return await aiMcpService.activateServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:deactivate', async (_event, serverId: string) => {
    return await aiMcpService.deactivateServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:restart', async (_event, serverId: string) => {
    return await aiMcpService.restartServer(serverId)
  })

  ipcMain.handle('ai:mcp:servers:check', async (_event, serverId: string) => {
    return await aiMcpService.checkServerConnectivity(serverId)
  })

  ipcMain.handle('ai:mcp:tools:list', async (_event, serverId: string) => {
    return await aiMcpService.listTools(serverId)
  })

  ipcMain.handle('ai:mcp:abort', async (_event, callId: string) => {
    return aiMcpService.abortTool(callId)
  })

  ipcMain.handle('ai:mcp:logs:get', async (_event, serverId: string) => {
    return aiMcpService.getLogs(serverId)
  })

  ipcMain.handle('ai:skills:list', async () => {
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.list()
  })

  ipcMain.handle('ai:skills:refresh', async () => {
    return await aiSkillService.refreshCatalog()
  })

  ipcMain.handle('ai:skills:list-enabled', async () => {
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.listEnabled()
  })

  ipcMain.handle('ai:skills:get', async (_event, skillId: string) => {
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.get(skillId)
  })

  ipcMain.handle('ai:skills:install', async (_event, input) => {
    const installed = await aiSkillService.install(input)
    await aiSkillService.refreshCatalog()
    return installed
  })

  ipcMain.handle('ai:skills:remove', async (_event, skillId: string) => {
    await aiSkillService.ensureCatalogLoaded()
    await aiSkillService.remove(skillId)
    await aiSkillService.refreshCatalog()
  })

  ipcMain.handle('ai:skills:enable', async (_event, skillId: string) => {
    await aiSkillService.ensureCatalogLoaded()
    return await aiSkillService.enable(skillId)
  })

  ipcMain.handle('ai:skills:disable', async (_event, skillId: string) => {
    await aiSkillService.ensureCatalogLoaded()
    return await aiSkillService.disable(skillId)
  })

  ipcMain.handle('ai:skills:preview', async (_event, input) => {
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.preview(input)
  })

  ipcMain.handle('ai:skills:resolve', async (_event, option: AiOption) => {
    await aiSkillService.ensureCatalogLoaded()
    return aiSkillService.resolveForAiCall(option)
  })

  ipcMain.handle('ai:attachments:upload', async (_event, input) => {
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

  ipcMain.handle('ai:tooling:webSearch:get', async () => {
    return appSettingsManager.getSettings().aiTooling.webSearch
  })

  ipcMain.handle('ai:tooling:webSearch:update', async (_event, partial: Partial<AiToolWebSearchSettings>) => {
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
  ipcMain.handle('ai:tooling:webSearch:getSettings', async () => {
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
  ipcMain.handle('ai:tooling:webSearch:setActiveProvider', async (_event, providerId: string) => {
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

  ipcMain.handle('ai:tooling:pluginTools:getDisabled', async () => {
    return appSettingsManager.getSettings().aiTooling.disabledPluginTools || []
  })

  ipcMain.handle('ai:tooling:pluginTools:setDisabled', async (_event, disabledList: string[]) => {
    const current = appSettingsManager.getSettings()
    const next = appSettingsManager.updateSettings({
      aiTooling: {
        ...current.aiTooling,
        disabledPluginTools: disabledList
      }
    })
    return next.aiTooling.disabledPluginTools || []
  })
}
