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
  method: 'GET',
  headers: { 'Authorization': 'Bearer token' }
});
```

**参数**:
- `url` (string) - 请求地址
- `method` (string) - 请求方法
- `headers` (object) - 请求头
- `body` (string|object) - 请求体
