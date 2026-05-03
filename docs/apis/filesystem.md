# 文件系统 API (filesystem)
本文档描述 文件系统 API (filesystem) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.filesystem`
> - 插件后端：`context.api.filesystem`

### readFile(path, encoding?)
[Renderer] [Backend]
读取文件内容。

```javascript
// 读取为 Buffer
const buffer = await filesystem.readFile('/path/to/file.png');

// 读取为文本
const text = await filesystem.readFile('/path/to/file.txt', 'utf-8');

// 读取为 Base64
const base64 = await filesystem.readFile('/path/to/image.jpg', 'base64');
```

**参数**:
- `path` (string) - 文件路径
- `encoding` (string, 可选) - 编码方式: `utf-8` | `base64`

**返回值**: `Buffer | Uint8Array | string`

### writeFile(path, data, encoding?)
[Renderer] [Backend]
写入文件。

```javascript
// 写入 Buffer
await filesystem.writeFile('/path/to/output.png', buffer);

// 写入文本
await filesystem.writeFile('/path/to/output.txt', 'Hello World', 'utf-8');

// 写入 Base64 数据
// 写入 ArrayBuffer 数据
await filesystem.writeFile('/path/to/output.pdf', arrayBuffer);
```

**参数**:
- `path` (string) - 文件路径
- `data` (Buffer | Uint8Array | ArrayBuffer | string) - 文件内容
- `encoding` (string, 可选) - 编码方式: `utf-8` | `base64`

### exists(path)
[Renderer] [Backend]
检查文件或目录是否存在。

```javascript
if (filesystem.exists('/path/to/file.txt')) {
  // 文件存在
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### unlink(path)
[Renderer] [Backend]
删除文件。

```javascript
await filesystem.unlink('/path/to/file.txt');
```

### readdir(path)
[Renderer] [Backend]
读取目录内容。

```javascript
const files = await filesystem.readdir('/path/to/dir');
// 返回: ['file1.txt', 'file2.txt', 'subdir']
```

**返回值**: `string[]` - 文件名数组

### mkdir(path)
[Renderer] [Backend]
创建目录（递归创建）。

```javascript
filesystem.mkdir('/path/to/new/dir');
```

### stat(path)
[Renderer] [Backend]
获取文件信息。

```javascript
const info = await filesystem.stat('/path/to/file.txt');
// 返回: { name, path, size, isFile, isDirectory, createdAt, modifiedAt }
```

**返回值**: `FileStat | null`

```typescript
interface FileStat {
  name: string;        // 文件名
  path: string;        // 完整路径
  size: number;        // 文件大小 (字节)
  isFile: boolean;     // 是否为文件
  isDirectory: boolean; // 是否为目录
  createdAt: number;   // 创建时间戳
  modifiedAt: number;  // 修改时间戳
}
```

### copy(src, dest)
[Renderer] [Backend]
复制文件。

```javascript
filesystem.copy('/path/to/source.txt', '/path/to/dest.txt');
```

### move(src, dest)
[Renderer] [Backend]
移动或重命名文件。

```javascript
filesystem.move('/path/to/old.txt', '/path/to/new.txt');
```

### 路径工具方法（仅插件后端）

> 仅 `context.api.filesystem` 可用，`window.mulby.filesystem` 不提供。

```javascript
// 获取扩展名
filesystem.extname('/path/to/file.txt');  // '.txt'

// 拼接路径
filesystem.join('/path', 'to', 'file.txt');  // '/path/to/file.txt'

// 获取目录名
filesystem.dirname('/path/to/file.txt');  // '/path/to'

// 获取文件名
filesystem.basename('/path/to/file.txt');  // 'file.txt'
filesystem.basename('/path/to/file.txt', '.txt');  // 'file'
```

### 完整示例

```javascript
// 写入并读取文件
const temp = await window.mulby.system.getPath('temp');
const filePath = `${temp}/mulby-demo.txt`;
window.mulby.await filesystem.writeFile(filePath, 'Hello Mulby', 'utf-8');
const text = window.mulby.await filesystem.readFile(filePath, 'utf-8');
console.log(text);
```
