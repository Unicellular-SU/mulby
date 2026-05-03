# Tray API (tray)
本文档描述 Tray API (tray) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.tray`
> - 插件后端：`context.api.tray`

Tray API 提供系统托盘功能，支持 macOS、Windows 和 Linux。

### create(options)
[Renderer] [Backend]
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

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否创建成功

### destroy()
[Renderer] [Backend]
销毁托盘图标。

```javascript
await tray.destroy();
```

### setIcon(icon)
[Renderer] [Backend]
更新托盘图标。

```javascript
await tray.setIcon('/path/to/new-icon.png');
```

**参数**:
- `icon` (string) - 图标路径或 base64 data URL

### setTooltip(tooltip)
[Renderer] [Backend]
设置鼠标悬停提示。

```javascript
await tray.setTooltip('新的提示文字');
```

### setTitle(title)
[Renderer] [Backend]
设置托盘标题（仅 macOS）。

```javascript
await tray.setTitle('运行中');
```

### exists()
[Renderer] [Backend]
检查托盘是否存在。

```javascript
if (await tray.exists()) {
  console.log('托盘已创建');
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### 完整示例

```javascript
await window.mulby.tray.create({
  icon: '/path/to/icon.png',
  tooltip: 'Mulby'
});
```