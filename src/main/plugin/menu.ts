import { Menu, BrowserWindow } from 'electron'

export interface MenuItemOptions {
  label: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  checked?: boolean
  enabled?: boolean
  id?: string
  submenu?: MenuItemOptions[]
}

export class PluginNativeMenu {
  /**
   * 显示上下文菜单
   */
  showContextMenu(
    items: MenuItemOptions[],
    window: BrowserWindow,
    callback: (id: string) => void
  ): void {
    const template = this.buildMenuTemplate(items, callback)
    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window })
  }

  private buildMenuTemplate(
    items: MenuItemOptions[],
    callback: (id: string) => void
  ): Electron.MenuItemConstructorOptions[] {
    return items.map(item => {
      if (item.type === 'separator') {
        return { type: 'separator' as const }
      }

      const menuItem: Electron.MenuItemConstructorOptions = {
        label: item.label,
        type: item.type || 'normal',
        checked: item.checked,
        enabled: item.enabled !== false,
        click: item.id ? () => callback(item.id!) : undefined
      }

      if (item.submenu) {
        menuItem.submenu = this.buildMenuTemplate(item.submenu, callback)
      }

      return menuItem
    })
  }
}

export const pluginNativeMenu = new PluginNativeMenu()
