# GlobalShortcut API (shortcut)
本文档描述 GlobalShortcut API (shortcut) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.shortcut`
> - 插件后端：`context.api.shortcut`

GlobalShortcut API 允许插件注册全局快捷键，支持 macOS、Windows 和 Linux。

### register(accelerator)
[Renderer] [Backend]
注册全局快捷键。

```javascript
const success = await shortcut.register('CommandOrControl+Shift+X');
if (success) {
  console.log('快捷键注册成功');
}
```

**参数**:
- `accelerator` (string) - 快捷键组合

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否注册成功

**快捷键格式**:
- 修饰键: `Command`(macOS), `Control`, `Alt`, `Shift`, `Meta`
- `CommandOrControl` - macOS 上为 Command，其他平台为 Control
- 示例: `CommandOrControl+X`, `Alt+Shift+P`, `F12`

### unregister(accelerator)
[Renderer] [Backend]
注销全局快捷键。

```javascript
await shortcut.unregister('CommandOrControl+Shift+X');
```

**参数**:
- `accelerator` (string) - 快捷键组合

### unregisterAll()
[Renderer] [Backend]
注销该插件注册的所有快捷键。

```javascript
await shortcut.unregisterAll();
```

### isRegistered(accelerator)
[Renderer] [Backend]
检查快捷键是否已被注册。

```javascript
const registered = await shortcut.isRegistered('CommandOrControl+X');
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### onTriggered(callback)
[Renderer] [Backend]
监听快捷键触发事件（仅插件 UI 中使用）。

```javascript
window.mulby.shortcut.onTriggered((accelerator) => {
  console.log(`快捷键 ${accelerator} 被触发`);
});
```

### 完整示例

```javascript
await window.mulby.shortcut.register('CommandOrControl+Shift+X');
window.mulby.shortcut.onTriggered((key) => console.log('triggered', key));
```