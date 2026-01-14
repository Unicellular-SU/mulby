## 9. Shell API (shell)

Shell API 提供系统级操作，包括打开文件、URL 和文件管理器，支持 macOS、Windows 和 Linux。

### 9.1 openPath(path)
使用系统默认应用打开文件。

```javascript
// 打开图片
await shell.openPath('/path/to/image.png');

// 打开文档
await shell.openPath('/path/to/document.pdf');
```

**参数**:
- `path` (string) - 文件路径

**返回值**: `string` - 错误信息，成功时为空字符串

### 9.2 openExternal(url)
使用系统默认浏览器打开 URL。

```javascript
await shell.openExternal('https://www.example.com');
await shell.openExternal('mailto:test@example.com');
```

**参数**:
- `url` (string) - URL 地址（支持 http、https、mailto 等协议）

### 9.3 showItemInFolder(path)
在文件管理器中显示并选中文件。

```javascript
// macOS: 在 Finder 中显示
// Windows: 在资源管理器中显示
// Linux: 在默认文件管理器中显示
shell.showItemInFolder('/path/to/file.txt');
```

**参数**:
- `path` (string) - 文件路径

### 9.4 openFolder(path)
打开文件所在目录。

```javascript
await shell.openFolder('/path/to/file.txt');
// 或直接打开目录
await shell.openFolder('/path/to/directory');
```

**参数**:
- `path` (string) - 文件或目录路径

**返回值**: `string` - 错误信息，成功时为空字符串

### 9.5 trashItem(path)
将文件移动到回收站/废纸篓。

```javascript
await shell.trashItem('/path/to/file.txt');
```

**参数**:
- `path` (string) - 文件路径

### 9.6 beep()
播放系统提示音。

```javascript
shell.beep();
```

### 9.7 完整示例

```javascript
module.exports = {
  async run(context) {
    const { shell, notification } = context.api;

    try {
      // 打开网页
      await shell.openExternal('https://github.com');

      // 在文件管理器中显示文件
      shell.showItemInFolder('/Users/test/Documents/file.txt');

      // 播放提示音
      shell.beep();

      notification.show('操作完成');
    } catch (error) {
      notification.show('操作失败: ' + error.message, 'error');
    }
  }
};
```
