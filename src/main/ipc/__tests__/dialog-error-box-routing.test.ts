import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const dialogIpcSourcePath = join(process.cwd(), 'src/main/ipc/dialog.ts')

describe('dialog error box routing', () => {
  it('routes showErrorBox through the internal error message box with the caller window as parent', () => {
    const source = readFileSync(dialogIpcSourcePath, 'utf8')

    assert.match(
      source,
      /ipcMain\.handle\('dialog:showErrorBox', async \(event, title: string, content: string\) => \{/,
      'dialog:showErrorBox must receive the IPC event so it can resolve the caller window'
    )
    assert.match(
      source,
      /const parentWindow = windowFromWebContents\(event\.sender\)/,
      'dialog:showErrorBox must resolve the caller window from the event sender'
    )
    assert.match(
      source,
      /showInternalMessageBox\(\{\s*type: 'error',\s*title,\s*message: content,/s,
      'dialog:showErrorBox must render through the internal error message box'
    )
    assert.match(
      source,
      /\}, \{ parentWindow \}\)/,
      'dialog:showErrorBox must pass the resolved parent window to the internal message box'
    )
    assert.doesNotMatch(
      source,
      /dialog\.showErrorBox\(title, content\)/,
      'dialog:showErrorBox must not call Electron native showErrorBox directly'
    )
  })
})
