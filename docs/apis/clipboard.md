## 1. 剪贴板 API (clipboard)

### 1.1 readText()
读取剪贴板文本内容。

```javascript
const text = clipboard.readText();
```

**返回值**: `string` - 剪贴板文本内容

### 1.2 writeText(text)
写入文本到剪贴板。

```javascript
await clipboard.writeText('Hello World');
```

**参数**:
- `text` (string) - 要写入的文本

### 1.3 readImage()
读取剪贴板图片。

```javascript
const imageBuffer = clipboard.readImage();
if (imageBuffer) {
  // 图片数据为 PNG 格式 Buffer
  filesystem.writeFile('/tmp/image.png', imageBuffer);
}
```

**返回值**: `Buffer | null` - PNG 格式图片数据，无图片时返回 null

### 1.4 writeImage(buffer)
写入图片到剪贴板。

```javascript
const imageData = filesystem.readFile('/path/to/image.png');
clipboard.writeImage(imageData);
```

**参数**:
- `buffer` (Buffer) - PNG 格式图片数据

### 1.5 readFiles()
读取剪贴板中的文件列表（支持 macOS/Windows/Linux）。

```javascript
const files = clipboard.readFiles();
// 返回: [{ path: '/path/to/file.pdf', name: 'file.pdf', size: 1024, isDirectory: false }]
```

**返回值**: `Array<ClipboardFileInfo>` - 文件信息数组

```typescript
interface ClipboardFileInfo {
  path: string;        // 文件绝对路径
  name: string;        // 文件名
  size: number;        // 文件大小 (字节)
  isDirectory: boolean; // 是否为目录
}
```

### 1.6 getFormat()
获取当前剪贴板内容的格式类型。

```javascript
const format = clipboard.getFormat();
// 返回: 'text' | 'image' | 'files' | 'empty'

if (format === 'image') {
  const image = clipboard.readImage();
} else if (format === 'files') {
  const files = clipboard.readFiles();
} else if (format === 'text') {
  const text = clipboard.readText();
}
```

**返回值**: `string` - 内容格式类型

### 1.7 完整示例

```javascript
module.exports = {
  async run(context) {
    const { clipboard, filesystem, notification } = context.api;

    const format = clipboard.getFormat();

    switch (format) {
      case 'image':
        const imageData = clipboard.readImage();
        filesystem.writeFile('/tmp/clipboard.png', imageData);
        notification.show('图片已保存');
        break;
      case 'files':
        const files = clipboard.readFiles();
        notification.show(`剪贴板包含 ${files.length} 个文件`);
        break;
      case 'text':
        const text = clipboard.readText();
        notification.show(`文本长度: ${text.length}`);
        break;
      default:
        notification.show('剪贴板为空');
    }
  }
};
```
