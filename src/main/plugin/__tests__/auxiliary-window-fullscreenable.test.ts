import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const pluginWindowSourcePath = join(process.cwd(), 'src/main/plugin/window.ts')

describe('auxiliary window fullscreenability', () => {
  it('allows normal child windows to enter fullscreen after creation by default', () => {
    const source = readFileSync(pluginWindowSourcePath, 'utf8')
    const createAuxiliaryWindowMatch = source.match(
      /createAuxiliaryWindow\([\s\S]*?\n\s*const win = new BrowserWindow\(\{([\s\S]*?)\n\s*\}\)/
    )

    assert.ok(createAuxiliaryWindowMatch, 'PluginWindowManager must create auxiliary BrowserWindow instances')
    assert.match(
      createAuxiliaryWindowMatch[1],
      /fullscreenable:\s*options\?\.fullscreenable \?\? true/,
      'normal auxiliary windows must be fullscreenable unless explicitly disabled'
    )
  })

  it('notifies the parent plugin contents when an auxiliary child window closes', () => {
    const source = readFileSync(pluginWindowSourcePath, 'utf8')
    const createAuxiliaryWindowMatch = source.match(
      /createAuxiliaryWindow\([\s\S]*?\n\s*private installDetachedDockRefreshHandlers/
    )
    assert.ok(createAuxiliaryWindowMatch, 'PluginWindowManager must create auxiliary BrowserWindow instances')

    const closeHandlerMatch = createAuxiliaryWindowMatch[0].match(/win\.on\('closed', \(\) => \{([\s\S]*?)\n\s*\}\)/)

    assert.match(
      source,
      /import \{ registerView, getPluginWebContents \} from '..\/services\/webcontents-registry'/,
      'PluginWindowManager must be able to target the parent plugin WebContentsView'
    )
    assert.match(
      source,
      /private notifyParentChildWindowClosed\(windowId: number, info: DetachedWindowInfo\): void/,
      'PluginWindowManager must expose a helper for parent close notifications'
    )
    assert.match(
      source,
      /targetWc\.send\('window:childMessage', 'child-window-closed',/,
      'close notification must be delivered through the parent window message channel'
    )
    assert.ok(closeHandlerMatch, 'auxiliary windows must install a closed handler')
    assert.match(
      closeHandlerMatch[1],
      /this\.notifyParentChildWindowClosed\(windowId, info\)/,
      'auxiliary closed handler must notify the direct parent before cleanup'
    )
  })
})
