import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const pluginDialogSourcePath = join(process.cwd(), 'src/main/plugin/dialog.ts')

describe('plugin dialog error box routing', () => {
  it('routes plugin showErrorBox through the internal error message box with the plugin window as parent', () => {
    const source = readFileSync(pluginDialogSourcePath, 'utf8')

    assert.match(
      source,
      /async showErrorBox\(title: string, content: string\): Promise<void> \{/,
      'plugin showErrorBox must be async because the internal message box is asynchronous'
    )
    assert.match(
      source,
      /const parentWindow = this\.resolveParentWindow\(\)/,
      'plugin showErrorBox must resolve the plugin caller window'
    )
    assert.match(
      source,
      /await showInternalMessageBox\(\{\s*type: 'error',\s*title,\s*message: content,/s,
      'plugin showErrorBox must render through the internal error message box'
    )
    assert.match(
      source,
      /\}, \{ parentWindow \}\)/,
      'plugin showErrorBox must pass the resolved parent window to the internal message box'
    )
    assert.doesNotMatch(
      source,
      /dialog\.showErrorBox\(title, content\)/,
      'plugin showErrorBox must not call Electron native showErrorBox directly'
    )
  })
})
