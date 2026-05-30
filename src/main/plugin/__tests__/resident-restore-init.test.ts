import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const panelWindowSourcePath = join(process.cwd(), 'src/main/plugin/panel-window.ts')
const pluginApiSourcePath = join(process.cwd(), 'src/preload/apis/app-plugin-api.ts')

describe('resident UI restore init payload', () => {
  it('sends fresh plugin:init payload when restoring a resident attached panel', () => {
    const source = readFileSync(panelWindowSourcePath, 'utf8')
    const restoreMethod = source.match(
      /restore\(featureCode: string, input\?: InputPayload, route\?: string\): boolean \{[\s\S]*?\n\s{4}\}/
    )

    assert.ok(restoreMethod, 'restore method must exist')
    assert.match(
      restoreMethod[0],
      /this\.currentAttachments = input\?\.attachments \|\| \[\]/,
      'resident restore must replace cached attachments with the latest launch input'
    )
    assert.match(
      restoreMethod[0],
      /pluginWebContents\.send\('plugin:init', \{[\s\S]*attachments: this\.currentAttachments,[\s\S]*nonce/,
      'resident restore must emit a new plugin:init payload containing the latest attachments'
    )
    assert.match(
      restoreMethod[0],
      /sendRestoreInit\('same-route'\)/,
      'same-route resident restore must still re-initialize the cached plugin UI'
    )
  })

  it('keeps plugin:init buffered while allowing live listeners to receive every launch', () => {
    const source = readFileSync(pluginApiSourcePath, 'utf8')

    assert.match(
      source,
      /bufferedData = data/,
      'preload should buffer the latest plugin:init for late React listeners'
    )
    assert.match(
      source,
      /ipcRenderer\.on\('plugin:init', listener\)/,
      'registered plugin init listeners should remain subscribed to future launch payloads'
    )
  })
})
