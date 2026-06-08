# Menu API (menu)
本文档描述 Menu API (menu) 的使用方法与接口。

> 入口：`window.mulby.menu`

Menu API 提供原生右键菜单功能，支持 macOS、Windows 和 Linux。

### showContextMenu(items)
[Renderer]
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

### showActionMenu(items, point?)
[Renderer]
在指定坐标显示一个轻量「操作菜单」（独立复用窗口），适合列表项「更多操作」、自定义右键等场景。

```javascript
const action = await menu.showActionMenu([
  { id: 'rename', label: '重命名' },
  { id: 'delete', label: '删除', danger: true },
  { id: 'sep', label: '', separator: true },
  { id: 'info', label: '详情', disabled: true }
], { x: 100, y: 200 });
```

**参数**:
- `items` (ActionMenuItem[]) - 菜单项数组
  - `id` (string) - 菜单项标识
  - `label` (string) - 菜单项文字
  - `separator` (boolean, 可选) - 是否为分隔线
  - `danger` (boolean, 可选) - 是否为危险操作（红色样式）
  - `disabled` (boolean, 可选) - 是否禁用
  - `checked` (boolean, 可选) - 是否勾选
- `point` (`{ x: number; y: number }`, 可选) - 弹出坐标，缺省跟随鼠标位置

**返回值**: `Promise<string | null>` - 选中的菜单项 id，取消返回 null

### 完整示例

```javascript
const id = await window.mulby.menu.showContextMenu([
  { label: '复制', id: 'copy' },
  { type: 'separator' },
  { label: '设置', id: 'settings' }
]);
console.log('selected:', id);
```