import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const windowIpcSourcePath = join(process.cwd(), 'src/main/ipc/window.ts')

describe('window child message routing', () => {
  it('routes ChildWindowHandle.postMessage to plugin webContents when a child uses WebContentsView', () => {
    const source = readFileSync(windowIpcSourcePath, 'utf8')
    const postMessageCase = source.match(/case 'postMessage':([\s\S]*?)\n\s*break/)

    assert.ok(postMessageCase, 'window:child:action must handle postMessage')
    assert.match(
      postMessageCase[1],
      /const childPluginWc = getPluginWebContents\(childWin\) \?\? childWin\.webContents/,
      'postMessage must target the plugin WebContentsView, not only the BrowserWindow titlebar webContents'
    )
    assert.match(
      postMessageCase[1],
      /childPluginWc\.send\('window:childMessage', String\(args\[0\] \?\? ''\), \.\.\.args\.slice\(1\)\)/,
      'postMessage must send child messages through the resolved plugin webContents'
    )
    assert.doesNotMatch(
      postMessageCase[1],
      /childWin\.webContents\.send\('window:childMessage'/,
      'postMessage must not send child messages directly to the outer BrowserWindow webContents'
    )
  })
})

