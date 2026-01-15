## 3. 输入 API (input)

输入 API 用于对外部应用执行粘贴或键入操作，适配 macOS、Windows、Linux。

注意：macOS 需要在系统设置中授予 InTools 辅助功能权限；Linux 依赖 `xdotool` 执行按键与输入（Wayland 环境可能受限）。

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

### 3.5 完整示例

```javascript
module.exports = {
  async run(context) {
    const { input } = context.api;
    await input.hideMainWindowPasteText('InTools rocks!');
  }
};
```
