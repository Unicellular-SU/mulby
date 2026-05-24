import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const floatingBallManagerSourcePath = join(process.cwd(), 'src/main/services/floating-ball-manager.ts')

describe('floating ball action execution', () => {
  it('routes click, double-click, and long-press gestures through the configured action executor', () => {
    const source = readFileSync(floatingBallManagerSourcePath, 'utf8')

    assert.match(source, /FloatingBallGesture/, 'manager should use the shared gesture type')
    assert.match(
      source,
      /ipcMain\.on\('floating-ball:longPress'[\s\S]*executeFloatingBallAction\('longPress'\)/,
      'long press IPC should execute the configured long-press action'
    )
    assert.match(
      source,
      /private handleClick\(\): void \{[\s\S]*executeFloatingBallAction\('click'\)/,
      'click should execute the configured click action'
    )
    assert.match(
      source,
      /private async handleDoubleClick\(\): Promise<void> \{[\s\S]*executeFloatingBallAction\('doubleClick'\)/,
      'double-click should execute the configured double-click action'
    )
  })

  it('supports inherited click, exact command execution, legacy command fallback, and built-in capture', () => {
    const source = readFileSync(floatingBallManagerSourcePath, 'utf8')

    assert.match(
      source,
      /private async executeFloatingBallAction\(gesture: FloatingBallGesture\): Promise<void>/,
      'manager should expose a single internal gesture action executor'
    )
    assert.match(
      source,
      /binding\.type === 'inheritClick'[\s\S]*executeFloatingBallAction\('click'\)/,
      'inheritClick should delegate to the current click action'
    )
    assert.match(
      source,
      /binding\.type === 'builtin'[\s\S]*binding\.action === 'toggleMulby'[\s\S]*toggleMainWindow\(\)/,
      'toggleMulby built-in action should toggle the main window'
    )
    assert.match(
      source,
      /binding\.type === 'builtin'[\s\S]*binding\.action === 'captureRegion'[\s\S]*handleRegionCapture\(\)/,
      'captureRegion built-in action should reuse the existing capture flow'
    )
    assert.match(
      source,
      /target\.cmdId && target\.cmdSignature[\s\S]*pluginManager\.runCommand/,
      'command actions with exact command metadata should use pluginManager.runCommand'
    )
    assert.match(
      source,
      /pluginManager\.run\(target\.pluginId, target\.featureCode/,
      'legacy command actions should fall back to pluginManager.run'
    )
  })

  it('only shows the host search window after command actions resolve to attached UI', () => {
    const source = readFileSync(floatingBallManagerSourcePath, 'utf8')
    const match = source.match(/private async executeCommandAction\(target: FloatingBallCommandTarget\): Promise<void> \{([\s\S]*?)\n {2}\}/)
    assert.ok(match, 'executeCommandAction should exist')
    const body = match[1]

    const firstShowIndex = body.indexOf('this.options.showMainWindow({ skipAutoPaste: true })')
    const runResultIndex = body.indexOf('const result = target.cmdId && target.cmdSignature')
    assert.ok(firstShowIndex !== -1, 'attached command actions should still show the host search window')
    assert.ok(runResultIndex !== -1, 'command actions should execute the plugin command')
    assert.ok(firstShowIndex > runResultIndex, 'the host window must not be shown before the plugin run decides the UI mode')
    assert.match(
      body,
      /result\.uiMode === 'attached'[\s\S]*this\.options\.showMainWindow\(\{ skipAutoPaste: true \}\)/,
      'only attached plugin UI launches should show the host search window'
    )
  })
})
