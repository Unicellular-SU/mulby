# 输入 API (input)
本文档描述 输入 API (input) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.input`
> - 插件后端：`context.api.input`

输入 API 用于对外部应用执行粘贴、键入操作以及模拟键盘和鼠标操作，适配 macOS、Windows、Linux。
调用时会先把输入焦点切回之前活跃的目标应用。附着模式窗口会被隐藏；独立窗口会保持可见，并在发送输入前把焦点还给目标应用。

注意：
- macOS 需要在系统设置中授予 Mulby 辅助功能权限
- Linux 依赖 `xdotool` 执行按键与输入（Wayland 环境可能受限）

### hideMainWindowPasteText(text)
[Renderer] [Backend]
将文本写入剪贴板并模拟粘贴到当前焦点应用。

```javascript
await input.hideMainWindowPasteText('Hello Mulby');
```

**参数**:
- `text` (string) - 要粘贴的文本

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

### hideMainWindowPasteImage(image)
[Renderer] [Backend]
将图片写入剪贴板并模拟粘贴到当前焦点应用。

```javascript
// Data URL
await input.hideMainWindowPasteImage('data:image/png;base64,...');

// 图片路径
await input.hideMainWindowPasteImage('/path/to/image.png');
```

**参数**:
- `image` (string | Buffer | ArrayBuffer | Uint8Array) - 图片路径、Data URL、Buffer、ArrayBuffer 或 Uint8Array

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

### hideMainWindowPasteFile(filePath)
[Renderer] [Backend]
将文件写入剪贴板并模拟粘贴到当前焦点应用。

```javascript
await input.hideMainWindowPasteFile('/path/to/report.pdf');
await input.hideMainWindowPasteFile(['/path/a.txt', '/path/b.txt']);
```

**参数**:
- `filePath` (string | string[]) - 文件路径或路径数组

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

**说明**: Windows 使用原生 `CF_HDROP` 文件列表写入剪贴板，macOS 和 Linux 使用各自平台的文件剪贴板格式。

### hideMainWindowTypeString(text)
[Renderer] [Backend]
将焦点切回目标应用并模拟键入文本（不依赖剪贴板）。附着模式窗口会先隐藏，独立窗口会保持可见。

```javascript
await input.hideMainWindowTypeString('Hello World!');
```

**参数**:
- `text` (string) - 要输入的文本

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

**注意**: 连续调用输入 API 时，被隐藏的附着窗口会保持隐藏状态，避免闪烁。完成所有输入后，调用 `restoreWindows()` 恢复窗口。

### restoreWindows()
[Renderer] [Backend]
恢复之前被输入 API 隐藏的窗口。

```javascript
// 连续输入示例
await input.hideMainWindowTypeString('username');
await input.simulateKeyboardTap('Tab');
await input.hideMainWindowTypeString('password');
// 所有输入完成后，恢复窗口
await input.restoreWindows();
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

**说明**:
- 当连续调用多个输入 API 时，窗口会保持隐藏状态，避免闪烁
- 完成所有输入操作后，调用此方法恢复窗口
- 如果不调用此方法，用户可以通过快捷键或 dock 图标手动恢复窗口
- 独立窗口输入时通常不会被隐藏，调用此方法是安全的 no-op

### simulateKeyboardTap(key, ...modifiers)
[Renderer] [Backend]
将焦点切回目标应用并模拟键盘按键，支持单键和组合键。附着模式窗口会先隐藏，独立窗口会保持可见。

```javascript
// 模拟单个键（发送到目标应用）
await input.simulateKeyboardTap('enter');

// 模拟组合键 Ctrl+V（Windows/Linux 粘贴）
await input.simulateKeyboardTap('v', 'ctrl');

// macOS 粘贴使用 Command 键
await input.simulateKeyboardTap('v', 'command');

// 多个修饰键组合 Ctrl+Alt+A
await input.simulateKeyboardTap('a', 'ctrl', 'alt');

// 功能键
await input.simulateKeyboardTap('f5');
```

**参数**:
- `key` (string) - 被模拟的主键，如 `'a'`, `'enter'`, `'f1'` 等
- `...modifiers` (string[]) - 可选的修饰键，如 `'ctrl'`, `'alt'`, `'shift'`, `'command'` 等

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

**支持的键名**:

| 类别 | 支持的键名 |
|------|-----------|
| 字母键 | a-z |
| 数字键 | 0-9 |
| 功能键 | enter, return, tab, space, backspace, delete, escape, esc |
| 方向键 | up, down, left, right |
| 导航键 | home, end, pageup, pagedown |
| F键 | f1-f12 |
| 其他 | capslock, printscreen, insert |

**支持的修饰键**:

| 修饰键 | 别名 |
|--------|------|
| ctrl | control |
| alt | option |
| shift | - |
| command | cmd, meta, super, win |

### simulateMouseMove(x, y)
[Renderer] [Backend]
将焦点切回目标应用并把鼠标移动到指定的屏幕坐标位置。附着模式窗口会先隐藏，独立窗口会保持可见。

```javascript
// 移动鼠标到屏幕坐标 (100, 200)
await input.simulateMouseMove(100, 200);
```

**参数**:
- `x` (number) - 相对于屏幕左上角的 X 坐标（像素）
- `y` (number) - 相对于屏幕左上角的 Y 坐标（像素）

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

### simulateMouseClick(x, y)
[Renderer] [Backend]
将焦点切回目标应用并模拟鼠标左键单击操作。附着模式窗口会先隐藏，独立窗口会保持可见。

```javascript
// 在坐标 (150, 200) 处单击
await input.simulateMouseClick(150, 200);
```

**参数**:
- `x` (number) - 相对于屏幕左上角的 X 坐标（像素）
- `y` (number) - 相对于屏幕左上角的 Y 坐标（像素）

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

### simulateMouseDoubleClick(x, y)
[Renderer] [Backend]
将焦点切回目标应用并模拟鼠标左键双击操作。附着模式窗口会先隐藏，独立窗口会保持可见。

```javascript
// 在坐标 (150, 200) 处双击
await input.simulateMouseDoubleClick(150, 200);
```

**参数**:
- `x` (number) - 相对于屏幕左上角的 X 坐标（像素）
- `y` (number) - 相对于屏幕左上角的 Y 坐标（像素）

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

### simulateMouseRightClick(x, y)
[Renderer] [Backend]
将焦点切回目标应用并模拟鼠标右键点击操作。附着模式窗口会先隐藏，独立窗口会保持可见。

```javascript
// 在坐标 (200, 250) 处右键点击
await input.simulateMouseRightClick(200, 250);
```

**参数**:
- `x` (number) - 相对于屏幕左上角的 X 坐标（像素）
- `y` (number) - 相对于屏幕左上角的 Y 坐标（像素）

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否执行成功

### 完整示例

```javascript
module.exports = {
  async run(context) {
    const { input } = context.api;

    // 粘贴文本
    await input.hideMainWindowPasteText('Mulby rocks!');

    // 模拟键盘快捷键
    await input.simulateKeyboardTap('s', 'ctrl'); // Ctrl+S 保存

    // 模拟鼠标操作
    await input.simulateMouseMove(500, 300);
    await input.simulateMouseClick(500, 300);
  }
};
```

### 连续输入示例

当需要连续执行多个输入操作时（如填充表单），使用 `restoreWindows()` 避免窗口闪烁：

```javascript
module.exports = {
  async run(context) {
    const { input } = context.api;

    // 填充用户名
    await input.hideMainWindowTypeString('john_doe');

    // 切换到密码框
    await input.simulateKeyboardTap('Tab');

    // 填充密码
    await input.hideMainWindowTypeString('secret123');

    // 提交表单
    await input.simulateKeyboardTap('Enter');

    // 所有输入完成后，恢复窗口
    await input.restoreWindows();
  }
};
```

#### 注意事项

1. **坐标系统**: 鼠标操作使用的 `(x, y)` 坐标是以**整个屏幕**的左上角为原点，单位为像素。在多显示器环境下需要注意坐标计算。

2. **平台差异**: 
   - macOS 上使用 `command` 键代替 `ctrl` 执行常见快捷键
   - Windows/Linux 上使用 `ctrl` 键
   - 独立窗口输入采用“窗口可见但目标应用获得焦点”的策略；这不是后台定向输入，目标应用仍需要能成为前台焦点

3. **权限要求**:
   - macOS: 需要在系统偏好设置中授予辅助功能权限
   - Windows: 输入模拟使用系统原生 `SendInput`，无法向更高完整性级别的受保护窗口注入输入
   - Linux: 依赖 `xdotool` 工具，Wayland 环境可能受限

4. **获取鼠标坐标**: 可以配合 `screen.getCursorScreenPoint()` API 获取当前鼠标位置：

```javascript
const { screen, input } = context.api;
const pos = screen.getCursorScreenPoint();
console.log(`当前鼠标位置: (${pos.x}, ${pos.y})`);
```
