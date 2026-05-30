import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

describe('sync Cherry Studio AI defaults script', () => {
  it('extracts providers and models from a Cherry Studio style source tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'mulby-cs-sync-'))
    try {
      const configDir = join(root, 'src', 'renderer', 'config')
      const modelsDir = join(configDir, 'models')
      mkdirSync(modelsDir, { recursive: true })
      writeFileSync(join(configDir, 'providers.ts'), `
        export const SYSTEM_PROVIDERS_CONFIG = {
          deepseek: {
            id: 'deepseek',
            name: 'deepseek',
            type: 'openai',
            apiKey: '',
            apiHost: 'https://api.deepseek.com',
            anthropicApiHost: 'https://api.deepseek.com/anthropic',
            models: SYSTEM_MODELS.deepseek,
            isSystem: true,
            enabled: false
          },
          openai: {
            id: 'openai',
            name: 'OpenAI',
            type: 'openai-response',
            apiKey: '',
            apiHost: 'https://api.openai.com',
            models: SYSTEM_MODELS.openai,
            isSystem: true,
            enabled: false
          },
          vertexai: {
            id: 'vertexai',
            name: 'VertexAI',
            type: 'vertexai',
            apiKey: '',
            apiHost: '',
            models: SYSTEM_MODELS.vertexai,
            isSystem: true,
            enabled: false
          }
        } as const
      `)
      writeFileSync(join(modelsDir, 'default.ts'), `
        export const SYSTEM_MODELS = {
          defaultModel: [],
          deepseek: [
            {
              id: 'deepseek-chat',
              name: 'DeepSeek Chat',
              provider: 'deepseek',
              group: 'DeepSeek',
              capabilities: [{ type: 'function_calling' }]
            }
          ],
          openai: [
            {
              id: 'gpt-5.1',
              name: 'GPT 5.1',
              provider: 'openai',
              group: 'OpenAI',
              endpoint_type: 'openai-response'
            }
          ],
          vertexai: [{ id: 'gemini-pro', name: 'Gemini Pro', provider: 'vertexai', group: 'Gemini' }]
        }
      `)

      const result = spawnSync(process.execPath, [
        'scripts/sync-cherry-ai-defaults.mjs',
        '--source',
        root,
        '--dry-run',
        '--summary-json'
      ], {
        cwd: process.cwd(),
        encoding: 'utf8'
      })

      assert.equal(result.status, 0, result.stderr || result.stdout)
      const summary = JSON.parse(result.stdout)
      assert.equal(summary.providers.deepseek.type, 'deepseek')
      assert.equal(summary.providers.deepseek.baseURL, 'https://api.deepseek.com')
      assert.equal(summary.providers.openai.type, 'openai-response')
      assert.equal(summary.providers.openai.baseURL, 'https://api.openai.com/v1')
      assert.equal(summary.providers.vertexai, undefined)
      assert.equal(summary.modelCountByProvider.deepseek, 1)
      assert.equal(summary.modelCountByProvider.openai, 1)
      assert.equal(summary.modelCountByProvider.vertexai, undefined)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
