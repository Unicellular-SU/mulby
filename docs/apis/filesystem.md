## 6. 文件系统 API (filesystem)

### 6.1 readFile(path, encoding?)
读取文件内容。

```javascript
// 读取为 Buffer
const buffer = filesystem.readFile('/path/to/file.png');

// 读取为文本
const text = filesystem.readFile('/path/to/file.txt', 'utf-8');

// 读取为 Base64
const base64 = filesystem.readFile('/path/to/image.jpg', 'base64');
```

**参数**:
- `path` (string) - 文件路径
- `encoding` (string, 可选) - 编码方式: `utf-8` | `base64`

**返回值**: `Buffer | string`

### 6.2 writeFile(path, data, encoding?)
写入文件。

```javascript
// 写入 Buffer
filesystem.writeFile('/path/to/output.png', buffer);

// 写入文本
filesystem.writeFile('/path/to/output.txt', 'Hello World', 'utf-8');

// 写入 Base64 数据
filesystem.writeFile('/path/to/output.jpg', base64String, 'base64');
```

**参数**:
- `path` (string) - 文件路径
- `data` (Buffer | string) - 文件内容
- `encoding` (string, 可选) - 编码方式: `utf-8` | `base64`

### 6.3 exists(path)
检查文件或目录是否存在。

```javascript
if (filesystem.exists('/path/to/file.txt')) {
  // 文件存在
}
```

**返回值**: `boolean`

### 6.4 unlink(path)
删除文件。

```javascript
filesystem.unlink('/path/to/file.txt');
```

### 6.5 readdir(path)
读取目录内容。

```javascript
const files = filesystem.readdir('/path/to/dir');
// 返回: ['file1.txt', 'file2.txt', 'subdir']
```

**返回值**: `string[]` - 文件名数组

### 6.6 mkdir(path)
创建目录（递归创建）。

```javascript
filesystem.mkdir('/path/to/new/dir');
```

### 6.7 stat(path)
获取文件信息。

```javascript
const info = filesystem.stat('/path/to/file.txt');
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

### 6.8 copy(src, dest)
复制文件。

```javascript
filesystem.copy('/path/to/source.txt', '/path/to/dest.txt');
```

### 6.9 move(src, dest)
移动或重命名文件。

```javascript
filesystem.move('/path/to/old.txt', '/path/to/new.txt');
```

### 6.10 路径工具方法

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
