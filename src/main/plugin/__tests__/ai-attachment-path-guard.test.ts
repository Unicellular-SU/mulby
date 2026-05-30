import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const pluginApiSourcePath = join(process.cwd(), 'src/main/plugin/api.ts')

describe('plugin AI attachment path guard', () => {
  it('prevents backend plugins from passing arbitrary host file paths into AI attachments', () => {
    const source = readFileSync(pluginApiSourcePath, 'utf8')

    assert.match(
      source,
      /function rejectPluginAiAttachmentFilePath\(pluginName: string, input: \{ filePath\?: string \}\): void/,
      'plugin AI API must define a filePath guard for attachment uploads'
    )
    assert.match(
      source,
      /attachments: \{[\s\S]*?upload: async \(input: \{ filePath\?: string; buffer\?: ArrayBuffer; mimeType: string; purpose\?: string \}\) => \{[\s\S]*?rejectPluginAiAttachmentFilePath\(pluginName, input\)[\s\S]*?aiService\.uploadAttachment\(input\)/,
      'plugin AI attachment upload must reject filePath before delegating to aiService'
    )
  })
})
