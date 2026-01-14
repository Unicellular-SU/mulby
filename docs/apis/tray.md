## 16. Tray API (tray)

Tray API 提供系统托盘功能，支持 macOS、Windows 和 Linux。

### 16.1 create(options)
创建系统托盘图标。

```javascript
const success = await tray.create({
  icon: '/path/to/icon.png',  // 或 base64 data URL
  tooltip: '我的插件',
  title: '状态'  // 仅 macOS
});
```

**参数** (TrayOptions):
- `icon` (string) - 图标路径或 base64 data URL
- `tooltip` (string, 可选) - 鼠标悬停提示
- `title` (string, 可选) - 托盘标题（仅 macOS）

**返回值**: `boolean` - 是否创建成功

### 16.2 destroy()
销毁托盘图标。

```javascript
await tray.destroy();
```

### 16.3 setIcon(icon)
更新托盘图标。

```javascript
await tray.setIcon('/path/to/new-icon.png');
```

**参数**:
- `icon` (string) - 图标路径或 base64 data URL

### 16.4 setTooltip(tooltip)
设置鼠标悬停提示。

```javascript
await tray.setTooltip('新的提示文字');
```

### 16.5 setTitle(title)
设置托盘标题（仅 macOS）。

```javascript
await tray.setTitle('运行中');
```

### 16.6 exists()
检查托盘是否存在。

```javascript
if (await tray.exists()) {
  console.log('托盘已创建');
}
```

**返回值**: `boolean`
