## 18. Menu API (menu)

Menu API 提供原生右键菜单功能，支持 macOS、Windows 和 Linux。

### 18.1 showContextMenu(items)
显示上下文菜单。

```javascript
const selectedId = await menu.showContextMenu([
  { label: '复制', id: 'copy' },
  { label: '粘贴', id: 'paste' },
  { type: 'separator' },
  { label: '设置', id: 'settings', submenu: [
    { label: '选项1', id: 'opt1' },
    { label: '选项2', id: 'opt2' }
  ]}
]);

if (selectedId === 'copy') {
  // 处理复制
}
```

**参数** (MenuItemOptions[]):
- `label` (string) - 菜单项文字
- `type` ('normal' | 'separator' | 'checkbox' | 'radio', 可选)
- `checked` (boolean, 可选) - checkbox/radio 选中状态
- `enabled` (boolean, 可选) - 是否启用，默认 true
- `id` (string, 可选) - 菜单项标识
- `submenu` (MenuItemOptions[], 可选) - 子菜单

**返回值**: `string | null` - 选中的菜单项 id，取消返回 null
