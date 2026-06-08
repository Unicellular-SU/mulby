import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const aiIpcSourcePath = join(process.cwd(), 'src/main/ipc/ai.ts')

// 仅「含密钥 / 会改配置」的接口对插件保持 system-only。
// 只读发现类（skills:list/list-enabled/get/preview/resolve、mcp:servers:list[脱敏]/tools:list、
// webSearch:getSettings/setActiveProvider、pluginTools:getDisabled）已对插件开放，故不在此列表。
const HOST_AI_CHANNELS = [
  'ai:settings:get',
  'ai:settings:update',
  'ai:models:fetch',
  'ai:test',
  'ai:test:stream',
  'ai:mcp:servers:get',
  'ai:mcp:servers:upsert',
  'ai:mcp:servers:remove',
  'ai:mcp:servers:activate',
  'ai:mcp:servers:deactivate',
  'ai:mcp:servers:restart',
  'ai:mcp:servers:check',
  'ai:mcp:abort',
  'ai:mcp:logs:get',
  'ai:skills:refresh',
  'ai:skills:install',
  'ai:skills:remove',
  'ai:skills:enable',
  'ai:skills:disable',
  'ai:tooling:webSearch:get',
  'ai:tooling:webSearch:update',
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
