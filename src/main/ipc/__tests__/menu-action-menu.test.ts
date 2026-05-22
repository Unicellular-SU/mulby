import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const menuIpcSourcePath = join(process.cwd(), 'src/main/ipc/menu.ts')
const ipcIndexSourcePath = join(process.cwd(), 'src/main/ipc/index.ts')

describe('menu action menu IPC', () => {
  it('routes renderer action menus through ActionMenuWindowManager', () => {
    const source = readFileSync(menuIpcSourcePath, 'utf8')

    assert.match(
      source,
      /export function registerMenuHandlers\(actionMenuWindowManager: ActionMenuWindowManager\)/,
      'menu handlers must receive the shared ActionMenuWindowManager'
    )
    assert.match(
      source,
      /ipcMain\.handle\('menu:showActionMenu'[\s\S]*actionMenuWindowManager\.showForSelection\(/,
      'menu:showActionMenu must show the reusable independent action menu window'
    )
    assert.match(
      source,
      /items: normalizeActionMenuItems\(items\)/,
      'renderer-provided action menu items must be normalized before display'
    )
  })

  it('registers menu handlers with the app action menu manager', () => {
    const source = readFileSync(ipcIndexSourcePath, 'utf8')

    assert.match(
      source,
      /registerMenuHandlers\(actionMenuWindowManager\)/,
      'registerAllHandlers must pass the app ActionMenuWindowManager into menu handlers'
    )
  })
})
