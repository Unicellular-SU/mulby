# InTools API 接口参考

## 1. 剪贴板 API (clipboard)

### 1.1 readText()
读取剪贴板文本内容。

```javascript
// Node.js
const text = await clipboard.readText();
```

```python
# Python
text = clipboard.read_text()
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
const imageBuffer = await clipboard.readImage();
```

**返回值**: `Buffer` - 图片数据 (PNG 格式)

### 1.4 writeImage(buffer)
写入图片到剪贴板。

```javascript
await clipboard.writeImage(imageBuffer);
```

**参数**:
- `buffer` (Buffer) - PNG 格式图片数据

### 1.5 readFiles()
读取剪贴板中的文件列表。

```javascript
// Node.js
const files = await clipboard.readFiles();
// 返回: [{ path: '/path/to/file.pdf', name: 'file.pdf', size: 1024, type: 'application/pdf' }]
```

```python
# Python
files = clipboard.read_files()
```

**返回值**: `Array<FileInfo>` - 文件信息数组

```typescript
interface FileInfo {
  path: string;      // 文件绝对路径
  name: string;      // 文件名
  size: number;      // 文件大小 (字节)
  type: string;      // MIME 类型
  isDirectory: boolean;  // 是否为目录
}
```

### 1.6 hasFiles()
检查剪贴板是否包含文件。

```javascript
const hasFiles = await clipboard.hasFiles();
if (hasFiles) {
  const files = await clipboard.readFiles();
}
```

**返回值**: `boolean`

### 1.7 getFormat()
获取当前剪贴板内容的格式类型。

```javascript
const format = await clipboard.getFormat();
// 返回: 'text' | 'image' | 'files' | 'html' | 'empty'
```

**返回值**: `string` - 内容格式类型

## 2. 通知 API (notification)

### 2.1 show(message, type?)
显示系统通知。

```javascript
notification.show('操作成功');
notification.show('发生错误', 'error');
```

**参数**:
- `message` (string) - 通知内容
- `type` (string, 可选) - 通知类型: info | success | warning | error

## 3. 存储 API (storage)

### 3.1 get(key)
获取存储的数据。

```javascript
const value = await storage.get('myKey');
```

### 3.2 set(key, value)
存储数据。

```javascript
await storage.set('myKey', { foo: 'bar' });
```

### 3.3 remove(key)
删除存储的数据。

```javascript
await storage.remove('myKey');
```

## 4. 窗口 API (window)

### 4.1 setSize(width, height)
设置插件窗口大小。

```javascript
await window.setSize(600, 400);
```

### 4.2 hide()
隐藏主窗口。

```javascript
await window.hide();
```

## 5. 网络 API (http)

### 5.1 request(options)
发起 HTTP 请求。

```javascript
const response = await http.request({
  url: 'https://api.example.com/data',
  method: 'POST',
  headers: { 'Authorization': 'Bearer token' },
  body: { key: 'value' },
  timeout: 5000
});

console.log(response.status);  // 200
console.log(response.data);    // 响应内容
```

**参数** (HttpRequestOptions):
- `url` (string) - 请求地址
- `method` (string, 可选) - 请求方法: GET | POST | PUT | DELETE | PATCH | HEAD，默认 GET
- `headers` (object, 可选) - 请求头
- `body` (string | object, 可选) - 请求体，object 会自动 JSON 序列化
- `timeout` (number, 可选) - 超时时间(毫秒)，默认 30000

**返回值** (HttpResponse):

```typescript
interface HttpResponse {
  status: number;      // HTTP 状态码
  statusText: string;  // 状态描述
  headers: Record<string, string>;  // 响应头
  data: string;        // 响应内容
}
```

### 5.2 get(url, headers?)
GET 请求快捷方法。

```javascript
const response = await http.get('https://api.example.com/users');
const data = JSON.parse(response.data);
```

### 5.3 post(url, body?, headers?)
POST 请求快捷方法。

```javascript
const response = await http.post('https://api.example.com/users', {
  name: 'John',
  email: 'john@example.com'
});
```

### 5.4 put(url, body?, headers?)
PUT 请求快捷方法。

```javascript
const response = await http.put('https://api.example.com/users/1', {
  name: 'John Updated'
});
```

### 5.5 delete(url, headers?)
DELETE 请求快捷方法。

```javascript
const response = await http.delete('https://api.example.com/users/1');
```

### 5.6 完整示例

```javascript
module.exports = {
  async run(context) {
    const { http, notification } = context.api;

    try {
      // 调用翻译 API
      const response = await http.post('https://api.translate.com/v1/translate', {
        text: context.input,
        from: 'zh',
        to: 'en'
      }, {
        'Authorization': 'Bearer YOUR_API_KEY'
      });

      if (response.status === 200) {
        const result = JSON.parse(response.data);
        notification.show('翻译完成: ' + result.translation);
      } else {
        notification.show('翻译失败', 'error');
      }
    } catch (error) {
      notification.show('网络错误', 'error');
    }
  }
};
```

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
