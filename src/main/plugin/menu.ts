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
    callback: (id: string | null) => void
  ): void {
    let selectedId: string | null = null

    const template = this.buildMenuTemplate(items, (id) => {
      selectedId = id
    })

    const menu = Menu.buildFromTemplate(template)

    // 使用菜单关闭事件来触发回调
    menu.popup({
      window,
      callback: () => {
        // 菜单关闭时返回选中的 id（可能为 null）
        callback(selectedId)
      }
    })
  }

  private buildMenuTemplate(
    items: MenuItemOptions[],
    onSelect: (id: string) => void
  ): Electron.MenuItemConstructorOptions[] {
    return items.map(item => {
      if (item.type === 'separator') {
        return { type: 'separator' as const }
      }

      const menuItem: Electron.MenuItemConstructorOptions = {
        label: item.label,
        type: item.type || (item.submenu ? 'submenu' : 'normal'),
        checked: item.checked,
        enabled: item.enabled !== false,
      }

      // 只有有 id 且没有 submenu 的项才添加 click 回调
      if (item.id && !item.submenu) {
        menuItem.click = () => onSelect(item.id!)
      }

      // 递归处理子菜单
      if (item.submenu) {
        menuItem.submenu = this.buildMenuTemplate(item.submenu, onSelect)
      }

      return menuItem
    })
  }
}

export const pluginNativeMenu = new PluginNativeMenu()

