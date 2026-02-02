import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { aiService } from '../ai'
import { getAiSettings, updateAiSettings } from '../ai/config'
import { resetProviderRegistry } from '../ai/providers'
import type { AiOption, AiMessage } from '../../shared/types/ai'

export function registerAiHandlers() {
  ipcMain.handle('ai:call', async (_event: IpcMainInvokeEvent, option: AiOption) => {
    return await aiService.call(option)
  })

  ipcMain.handle('ai:stream', async (event: IpcMainInvokeEvent, option: AiOption) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    aiService
      .stream(option, {
        onChunk: (chunk: AiMessage) => {
          event.sender.send('ai:stream:chunk', requestId, chunk)
        },
        onEnd: (message: AiMessage) => {
          event.sender.send('ai:stream:end', requestId, message)
        },
        onError: (error: Error) => {
          event.sender.send('ai:stream:error', requestId, error.message)
        }
      }, requestId)
      .catch(() => {
        // errors handled in onError
      })

    return { requestId }
  })

  ipcMain.handle('ai:abort', async (_event: IpcMainInvokeEvent, requestId: string) => {
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

  ipcMain.handle('ai:attachments:upload', async (_event, input) => {
    return await aiService.uploadAttachment(input)
  })

  ipcMain.handle('ai:attachments:get', async (_event, attachmentId: string) => {
    return await aiService.getAttachment(attachmentId)
  })

  ipcMain.handle('ai:attachments:delete', async (_event, attachmentId: string) => {
    return await aiService.deleteAttachment(attachmentId)
  })

  ipcMain.handle('ai:cost:estimate', async (_event, input) => {
    return await aiService.estimateCost(input)
  })

  ipcMain.handle('ai:images:generate', async (_event, input) => {
    return await aiService.generateImages(input)
  })

  ipcMain.handle('ai:images:edit', async (_event, input) => {
    return await aiService.editImage(input)
  })

  ipcMain.handle('ai:videos:generate', async (_event, input) => {
    return await aiService.generateVideo(input)
  })
}
