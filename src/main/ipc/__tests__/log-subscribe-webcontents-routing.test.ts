import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const logIpcSourcePath = join(process.cwd(), 'src/main/ipc/log.ts')

describe('log subscribe webContents routing', () => {
  it('routes live log events to plugin WebContentsView when subscribed from a plugin page', () => {
    const source = readFileSync(logIpcSourcePath, 'utf8')

    assert.match(
      source,
      /import \{ windowFromWebContents, getPluginWebContents \} from '..\/services\/webcontents-registry'/,
      'log IPC must import getPluginWebContents so plugin pages embedded in WebContentsView can receive live events'
    )
    assert.match(
      source,
      /const targetWebContents = getPluginWebContents\(win\) \?\? win\.webContents/,
      'log:subscribe must resolve the plugin WebContentsView before falling back to the outer BrowserWindow webContents'
    )
    assert.match(
      source,
      /loggerService\.broadcastTo\(targetWebContents, entry\)/,
      'live log entries must be broadcast to the resolved target webContents'
    )
    assert.doesNotMatch(
      source,
      /loggerService\.broadcastTo\(win, entry\)/,
      'log:subscribe must not send live log entries only to the outer BrowserWindow'
    )
  })
})
