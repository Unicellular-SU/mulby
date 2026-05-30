import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const onboardingIpcSourcePath = join(process.cwd(), 'src/main/ipc/onboarding.ts')

const ONBOARDING_CHANNELS = [
  'onboarding:getSettings',
  'onboarding:updateShortcut',
  'onboarding:updateTheme',
  'onboarding:updateAiProvider',
  'onboarding:updateStoreSources',
  'onboarding:updateSuperPanel',
  'onboarding:complete'
] as const

describe('onboarding IPC system-only channels', () => {
  it('protects onboarding setup writes from plugin windows', () => {
    const source = readFileSync(onboardingIpcSourcePath, 'utf8')

    assert.match(
      source,
      /import \{ appOnlyInvoke \} from '\.\/_shared\/caller-middleware'/,
      'onboarding IPC should reuse the shared app-only caller guard'
    )

    for (const channel of ONBOARDING_CHANNELS) {
      const handlerPattern = new RegExp(
        `ipcMain\\.handle\\('${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s*appOnlyInvoke\\(`,
        'm'
      )
      assert.match(
        source,
        handlerPattern,
        `${channel} must reject plugin/untrusted callers before mutating setup state`
      )
    }
  })
})
