import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const aiIpcSourcePath = join(process.cwd(), 'src/main/ipc/ai.ts')

const HOST_AI_CHANNELS = [
  'ai:settings:get',
  'ai:settings:update',
  'ai:models:fetch',
  'ai:test',
  'ai:test:stream',
  'ai:mcp:servers:list',
  'ai:mcp:servers:get',
  'ai:mcp:servers:upsert',
  'ai:mcp:servers:remove',
  'ai:mcp:servers:activate',
  'ai:mcp:servers:deactivate',
  'ai:mcp:servers:restart',
  'ai:mcp:servers:check',
  'ai:mcp:tools:list',
  'ai:mcp:abort',
  'ai:mcp:logs:get',
  'ai:skills:list',
  'ai:skills:refresh',
  'ai:skills:list-enabled',
  'ai:skills:get',
  'ai:skills:install',
  'ai:skills:remove',
  'ai:skills:enable',
  'ai:skills:disable',
  'ai:skills:preview',
  'ai:skills:resolve',
  'ai:tooling:webSearch:get',
  'ai:tooling:webSearch:update',
  'ai:tooling:webSearch:getSettings',
  'ai:tooling:webSearch:setActiveProvider',
  'ai:tooling:pluginTools:getDisabled',
  'ai:tooling:pluginTools:setDisabled'
] as const

describe('AI IPC system-only channels', () => {
  it('protects host AI configuration and provider probing from plugin windows', () => {
    const source = readFileSync(aiIpcSourcePath, 'utf8')

    assert.match(
      source,
      /function ensureAiSystemWindowCaller\(event: IpcMainInvokeEvent, channel: string\)/,
      'AI IPC must define a reusable system-window guard for host configuration channels'
    )
    assert.match(
      source,
      /resolveIpcCallerSource\(event\.sender\)/,
      'AI IPC guard must use the shared WebContents-aware caller resolver'
    )

    for (const channel of HOST_AI_CHANNELS) {
      const handlerPattern = new RegExp(
        `ipcMain\\.handle\\('${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}', async \\(event[^)]*\\) => \\{[\\s\\S]*?ensureAiSystemWindowCaller\\(event, '${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`,
        'm'
      )
      assert.match(
        source,
        handlerPattern,
        `${channel} must reject plugin/untrusted callers before touching AI settings or provider network state`
      )
    }
  })

  it('does not let plugin renderers upload arbitrary host file paths as AI attachments', () => {
    const source = readFileSync(aiIpcSourcePath, 'utf8')

    assert.match(
      source,
      /function ensureAiAttachmentUploadAllowed\(event: IpcMainInvokeEvent, input: \{ filePath\?: string \}\): void/,
      'AI attachment upload must guard filePath inputs before main-process file reads'
    )
    assert.match(
      source,
      /ipcMain\.handle\('ai:attachments:upload', async \(event: IpcMainInvokeEvent, input\) => \{[\s\S]*?ensureAiAttachmentUploadAllowed\(event, input\)[\s\S]*?aiService\.uploadAttachment\(input\)/,
      'ai:attachments:upload must reject plugin filePath uploads while preserving buffer uploads'
    )
  })
})
