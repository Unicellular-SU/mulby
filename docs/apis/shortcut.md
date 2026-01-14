## 12. GlobalShortcut API (shortcut)

GlobalShortcut API 允许插件注册全局快捷键，支持 macOS、Windows 和 Linux。

### 12.1 register(accelerator)
注册全局快捷键。

```javascript
const success = await shortcut.register('CommandOrControl+Shift+X');
if (success) {
  console.log('快捷键注册成功');
}
```

**参数**:
- `accelerator` (string) - 快捷键组合

**返回值**: `boolean` - 是否注册成功

**快捷键格式**:
- 修饰键: `Command`(macOS), `Control`, `Alt`, `Shift`, `Meta`
- `CommandOrControl` - macOS 上为 Command，其他平台为 Control
- 示例: `CommandOrControl+X`, `Alt+Shift+P`, `F12`

### 12.2 unregister(accelerator)
注销全局快捷键。

```javascript
await shortcut.unregister('CommandOrControl+Shift+X');
```

**参数**:
- `accelerator` (string) - 快捷键组合

### 12.3 unregisterAll()
注销该插件注册的所有快捷键。

```javascript
await shortcut.unregisterAll();
```

### 12.4 isRegistered(accelerator)
检查快捷键是否已被注册。

```javascript
const registered = await shortcut.isRegistered('CommandOrControl+X');
```

**返回值**: `boolean`

### 12.5 onTriggered(callback)
监听快捷键触发事件（仅插件 UI 中使用）。

```javascript
window.intools.shortcut.onTriggered((accelerator) => {
  console.log(`快捷键 ${accelerator} 被触发`);
});
```
