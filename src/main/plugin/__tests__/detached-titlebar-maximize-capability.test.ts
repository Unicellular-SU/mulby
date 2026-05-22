import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const titlebarViewSourcePath = join(process.cwd(), 'src/main/plugin/titlebar-view.ts')
const titlebarHtmlPath = join(process.cwd(), 'public/detached-titlebar.html')
const windowIpcSourcePath = join(process.cwd(), 'src/main/ipc/window.ts')
const pluginWindowSourcePath = join(process.cwd(), 'src/main/plugin/window.ts')

describe('detached titlebar maximize capability', () => {
  it('uses resizable state to decide whether the custom titlebar can maximize', () => {
    const source = readFileSync(titlebarViewSourcePath, 'utf8')

    assert.match(
      source,
      /function canMaximizeWindow\(win: BrowserWindow\): boolean \{[\s\S]*win\.isResizable\(\)/,
      'titlebar state must follow the actual resizable flag'
    )
    assert.doesNotMatch(
      source,
      /canMaximizeWindow[\s\S]*?isMaximizable\(\)/,
      'frameless custom-titlebar windows should not depend on Electron isMaximizable()'
    )
    assert.match(
      source,
      /case 'maximize':[\s\S]*if \(!canMaximizeWindow\(win\)\) return[\s\S]*win\.maximize\(\)/,
      'titlebar maximize action must no-op when the window is not resizable'
    )
    assert.match(
      source,
      /ipcMain\.handle\('titlebar:getState'[\s\S]*canMaximize/,
      'titlebar getState must expose canMaximize to the renderer'
    )
  })

  it('disables the detached titlebar maximize button when maximizing is unsupported', () => {
    const source = readFileSync(titlebarHtmlPath, 'utf8')

    assert.match(
      source,
      /let canMaximize = true/,
      'detached titlebar must track maximize capability locally'
    )
    assert.match(
      source,
      /btnMaximize\.disabled = !canMaximize/,
      'detached titlebar must disable the maximize button when unsupported'
    )
    assert.match(
      source,
      /if \(!canMaximize\) return[\s\S]*api\.action\('maximize'\)/,
      'detached titlebar click handler must guard disabled maximize'
    )
  })

  it('makes plugin window getState report canMaximize and guards window:maximize', () => {
    const source = readFileSync(windowIpcSourcePath, 'utf8')

    assert.match(
      source,
      /ipcMain\.on\('window:maximize'[\s\S]*if \(!win\.isResizable\(\)\) return[\s\S]*win\.maximize\(\)/,
      'window:maximize must no-op for non-resizable windows'
    )
    assert.match(
      source,
      /ipcMain\.handle\('window:getState'[\s\S]*canMaximize: win \? win\.isResizable\(\) : false/,
      'window:getState must expose canMaximize for injected titlebars'
    )
  })

  it('keeps normal detached plugin windows fullscreenable unless explicitly disabled', () => {
    const source = readFileSync(pluginWindowSourcePath, 'utf8')
    const createDetachedWindowMatch = source.match(
      /createDetachedWindow\([\s\S]*?\n\s*const win = new BrowserWindow\(\{([\s\S]*?)\n\s*\}\)/
    )

    assert.ok(createDetachedWindowMatch, 'PluginWindowManager must create detached BrowserWindow instances')
    assert.match(
      createDetachedWindowMatch[1],
      /fullscreenable:\s*isFullscreenable/,
      'normal detached windows must be fullscreenable by default so macOS maximize/zoom remains available'
    )
    assert.match(
      createDetachedWindowMatch[1],
      /resizable:\s*isResizable/,
      'normal detached windows must be resizable by default'
    )
    assert.match(
      createDetachedWindowMatch[1],
      /maximizable:\s*isMaximizable/,
      'normal detached windows must remain maximizable unless resizing is explicitly disabled'
    )
    assert.match(
      source,
      /const isResizable = windowConfig\.resizable \?\? true[\s\S]*const isMaximizable = windowConfig\.resizable !== false[\s\S]*const isFullscreenable = windowConfig\.fullscreenable \?\? true/,
      'detached window capability defaults must be explicit before BrowserWindow creation'
    )
    assert.match(
      source,
      /win\.setResizable\(isResizable\)[\s\S]*win\.setMaximizable\(isMaximizable\)[\s\S]*win\.setFullScreenable\(isFullscreenable\)/,
      'frameless detached windows must normalize resizable/maximizable/fullscreenable after creation'
    )
  })
})
