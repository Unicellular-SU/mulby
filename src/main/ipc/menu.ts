import { ipcMain } from 'electron'
import { pluginNativeMenu, MenuItemOptions } from '../plugin/menu'
import { windowFromWebContents } from '../services/webcontents-registry'
import { ActionMenuWindowManager, type ActionMenuItem, type ActionMenuAnchor } from '../services/action-menu-window-manager'

function normalizeActionMenuItems(input: unknown): ActionMenuItem[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((rawItem): ActionMenuItem[] => {
    if (!rawItem || typeof rawItem !== 'object') return []
    const item = rawItem as Record<string, unknown>
    const separator = item.separator === true
    const id = typeof item.id === 'string' ? item.id : ''
    const label = typeof item.label === 'string' ? item.label : ''
    if (!separator && (!id || !label.trim())) return []
    return [{
      id,
      label,
      separator,
      danger: item.danger === true,
      disabled: item.disabled === true,
      checked: typeof item.checked === 'boolean' ? item.checked : undefined
    }]
  })
}

function normalizeActionMenuAnchor(input: unknown): ActionMenuAnchor | undefined {
  if (!input || typeof input !== 'object') return undefined
  const point = input as Record<string, unknown>
  return {
    x: typeof point.x === 'number' ? point.x : undefined,
    y: typeof point.y === 'number' ? point.y : undefined
  }
}

export function registerMenuHandlers(actionMenuWindowManager: ActionMenuWindowManager) {
  // 显示上下文菜单
  ipcMain.handle('menu:showContextMenu', (event, items: MenuItemOptions[]) => {
    const win = windowFromWebContents(event.sender)
    if (!win) return

    return new Promise<string | null>((resolve) => {
      pluginNativeMenu.showContextMenu(items, win, (id) => {
        resolve(id)
      })
    })
  })

  ipcMain.handle('menu:showActionMenu', (event, items: unknown, point?: unknown) => {
    const win = windowFromWebContents(event.sender)
    if (!win || win.isDestroyed()) return null

    return actionMenuWindowManager.showForSelection({
      ownerWindow: win,
      anchor: normalizeActionMenuAnchor(point),
      items: normalizeActionMenuItems(items)
    })
  })
}
