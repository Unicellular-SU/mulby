## 3. 输入 API (input)

输入 API 用于对外部应用执行粘贴、键入操作以及模拟键盘和鼠标操作，适配 macOS、Windows、Linux。
调用时部分方法会先隐藏 InTools 窗口，以便目标应用接收输入焦点。

注意：
- macOS 需要在系统设置中授予 InTools 辅助功能权限
- Linux 依赖 `xdotool` 执行按键与输入（Wayland 环境可能受限）

### 3.1 hideMainWindowPasteText(text)
将文本写入剪贴板并模拟粘贴到当前焦点应用。

```javascript
await input.hideMainWindowPasteText('Hello InTools');
```

**参数**:
- `text` (string) - 要粘贴的文本

**返回值**: `boolean` - 是否执行成功

### 3.2 hideMainWindowPasteImage(image)
将图片写入剪贴板并模拟粘贴到当前焦点应用。

```javascript
// Data URL
await input.hideMainWindowPasteImage('data:image/png;base64,...');

// 图片路径
await input.hideMainWindowPasteImage('/path/to/image.png');
```

**参数**:
- `image` (string | Buffer) - 图片路径、Data URL 或 Buffer

**返回值**: `boolean` - 是否执行成功

### 3.3 hideMainWindowPasteFile(filePath)
将文件写入剪贴板并模拟粘贴到当前焦点应用。

```javascript
await input.hideMainWindowPasteFile('/path/to/report.pdf');
await input.hideMainWindowPasteFile(['/path/a.txt', '/path/b.txt']);
```

**参数**:
- `filePath` (string | string[]) - 文件路径或路径数组

**返回值**: `boolean` - 是否执行成功

### 3.4 hideMainWindowTypeString(text)
隐藏主窗口并模拟键入文本（不依赖剪贴板）。

```javascript
await input.hideMainWindowTypeString('Hello World!');
```

**参数**:
- `text` (string) - 要输入的文本

**返回值**: `boolean` - 是否执行成功

### 3.5 simulateKeyboardTap(key, ...modifiers)
模拟键盘按键，支持单键和组合键。

```javascript
// 模拟单个键
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

**返回值**: `void`

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

### 3.6 simulateMouseMove(x, y)
将鼠标移动到指定的屏幕坐标位置。

```javascript
// 移动鼠标到屏幕坐标 (100, 200)
await input.simulateMouseMove(100, 200);
```

**参数**:
- `x` (number) - 相对于屏幕左上角的 X 坐标（像素）
- `y` (number) - 相对于屏幕左上角的 Y 坐标（像素）

**返回值**: `void`

### 3.7 simulateMouseClick(x, y)
模拟鼠标左键单击操作。

```javascript
// 在坐标 (150, 200) 处单击
await input.simulateMouseClick(150, 200);
```

**参数**:
- `x` (number) - 相对于屏幕左上角的 X 坐标（像素）
- `y` (number) - 相对于屏幕左上角的 Y 坐标（像素）

**返回值**: `void`

### 3.8 simulateMouseDoubleClick(x, y)
模拟鼠标左键双击操作。

```javascript
// 在坐标 (150, 200) 处双击
await input.simulateMouseDoubleClick(150, 200);
```

**参数**:
- `x` (number) - 相对于屏幕左上角的 X 坐标（像素）
- `y` (number) - 相对于屏幕左上角的 Y 坐标（像素）

**返回值**: `void`

### 3.9 simulateMouseRightClick(x, y)
模拟鼠标右键点击操作。

```javascript
// 在坐标 (200, 250) 处右键点击
await input.simulateMouseRightClick(200, 250);
```

**参数**:
- `x` (number) - 相对于屏幕左上角的 X 坐标（像素）
- `y` (number) - 相对于屏幕左上角的 Y 坐标（像素）

**返回值**: `void`

### 3.10 完整示例

```javascript
module.exports = {
  async run(context) {
    const { input } = context.api;
    
    // 粘贴文本
    await input.hideMainWindowPasteText('InTools rocks!');
    
    // 模拟键盘快捷键
    await input.simulateKeyboardTap('s', 'ctrl'); // Ctrl+S 保存
    
    // 模拟鼠标操作
    await input.simulateMouseMove(500, 300);
    await input.simulateMouseClick(500, 300);
  }
};
```

### 注意事项

1. **坐标系统**: 鼠标操作使用的 `(x, y)` 坐标是以**整个屏幕**的左上角为原点，单位为像素。在多显示器环境下需要注意坐标计算。

2. **平台差异**: 
   - macOS 上使用 `command` 键代替 `ctrl` 执行常见快捷键
   - Windows/Linux 上使用 `ctrl` 键

3. **权限要求**:
   - macOS: 需要在系统偏好设置中授予辅助功能权限
   - Windows: 某些操作可能需要管理员权限
   - Linux: 依赖 `xdotool` 工具，Wayland 环境可能受限

4. **获取鼠标坐标**: 可以配合 `screen.getCursorScreenPoint()` API 获取当前鼠标位置：

```javascript
const { screen, input } = context.api;
const pos = screen.getCursorScreenPoint();
console.log(`当前鼠标位置: (${pos.x}, ${pos.y})`);
```
