# 剪贴板 API (clipboard)
本文档描述 剪贴板 API (clipboard) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.clipboard`
> - 插件后端：`context.api.clipboard`

插件必须在 `manifest.json` 中声明剪贴板权限：

```json
{
  "permissions": {
    "clipboard": true
  }
}
```

未声明时宿主会拦截调用并抛出 `Plugin "<pluginId>" lacks manifest.permissions.clipboard`。

### readText()
[Renderer] [Backend]
读取剪贴板文本内容。

```javascript
const text = await clipboard.readText();
```

**返回值**: `string`（插件后端返回 `Promise<string>`） - 剪贴板文本内容

### writeText(text)
[Renderer] [Backend]
写入文本到剪贴板。

```javascript
await clipboard.writeText('Hello World');
```

**参数**:
- `text` (string) - 要写入的文本

### readImage()
[Renderer] [Backend]
读取剪贴板图片。

```javascript
const imageBuffer = await clipboard.readImage();
if (imageBuffer) {
  // PNG 数据（渲染进程中可能表现为 Uint8Array）
  await filesystem.writeFile('/tmp/image.png', imageBuffer);
}
```

**返回值**: `Buffer | Uint8Array | null` - PNG 图片数据，无图片时返回 null

### writeImage(image)
[Renderer] [Backend]
写入图片到剪贴板。

```javascript
// Buffer / ArrayBuffer / Uint8Array
await clipboard.writeImage(imageData);

// 文件路径
await clipboard.writeImage('/path/to/image.png');

// Data URL
await clipboard.writeImage('data:image/png;base64,...');
```

**参数**:
- `image` (string | Buffer | ArrayBuffer | Uint8Array)
  - 渲染进程支持文件路径或 Data URL
  - 插件后端仅支持 `Buffer`

**返回值**:
- 渲染进程：`boolean` - 是否写入成功
- 插件后端：`Promise<void>`

### writeFiles(filePaths)
[Renderer]
将文件路径写入剪贴板（仅渲染进程可用）。

```javascript
await clipboard.writeFiles('/path/to/report.pdf');
await clipboard.writeFiles(['/path/a.txt', '/path/b.txt']);
```

**参数**:
- `filePaths` (string | string[]) - 文件路径

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### readFiles()
[Renderer] [Backend]
读取剪贴板中的文件列表（支持 macOS/Windows/Linux）。

```javascript
const files = await clipboard.readFiles();
// 返回: [{ path, name, size, type, isDirectory }]
```

**返回值**: `Array<ClipboardFileInfo>`（插件后端返回 `Promise<Array<ClipboardFileInfo>>`） - 文件信息数组（插件后端可能不包含 `type`）

```typescript
interface ClipboardFileInfo {
  path: string;         // 文件绝对路径
  name: string;         // 文件名
  size: number;         // 文件大小 (字节)
  type?: string;        // MIME 类型（渲染进程返回，插件后端可能缺失）
  isDirectory: boolean; // 是否为目录
}
```

### getFormat()
[Renderer] [Backend]
获取当前剪贴板内容的格式类型。

```javascript
const format = await clipboard.getFormat();
// 渲染进程可能返回: 'text' | 'image' | 'files' | 'html' | 'empty'
```

**返回值**:
- 渲染进程：`'text' | 'image' | 'files' | 'html' | 'empty'`
- 插件后端：`Promise<'text' | 'image' | 'files' | 'empty'>`

### 完整示例

```javascript
module.exports = {
  async run(context) {
    const { clipboard, filesystem, notification } = context.api;

    const format = await clipboard.getFormat();

    switch (format) {
      case 'image':
        const imageData = await clipboard.readImage();
        await filesystem.writeFile('/tmp/clipboard.png', imageData);
        await notification.show('图片已保存');
        break;
      case 'files':
        const files = await clipboard.readFiles();
        await notification.show(`剪贴板包含 ${files.length} 个文件`);
        break;
      case 'text':
        const text = await clipboard.readText();
        await notification.show(`文本长度: ${text.length}`);
        break;
      default:
        await notification.show('剪贴板为空');
    }
  }
};
```
