import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const inBrowserWindowSourcePath = join(process.cwd(), 'src/main/browser/InBrowserWindow.ts')

describe('InBrowser download operation', () => {
  it('registers will-download before starting the download', () => {
    const source = readFileSync(inBrowserWindowSourcePath, 'utf8')
    const downloadCase = source.match(/case 'download': \{([\s\S]*?)\n\s*break;/)

    assert.ok(downloadCase, 'InBrowserWindow must implement the download operation')

    const handlerIndex = downloadCase[1].indexOf("win.webContents.session.once('will-download'")
    const downloadIndex = downloadCase[1].indexOf('win.webContents.downloadURL(downloadUrl)')

    assert.notEqual(handlerIndex, -1, 'download operation must install a will-download handler')
    assert.notEqual(downloadIndex, -1, 'download operation must call downloadURL')
    assert.ok(
      handlerIndex < downloadIndex,
      'will-download handler must be installed before downloadURL is called'
    )
  })
})

