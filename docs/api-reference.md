# InTools API 接口参考

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

## 7. 主题 API (theme)

主题 API 允许插件获取和跟随主程序的主题设置，实现视觉一致性。

### 7.1 get()
获取当前主题信息。

```javascript
const themeInfo = await window.intools.theme.get();
// 返回: { mode: 'system', actual: 'dark' }
```

**返回值**: `ThemeInfo`

```typescript
interface ThemeInfo {
  mode: 'light' | 'dark' | 'system';  // 用户设置的主题模式
  actual: 'light' | 'dark';            // 实际应用的主题
}
```

### 7.2 set(mode)
设置主题模式。

```javascript
await window.intools.theme.set('dark');   // 设置为暗色主题
await window.intools.theme.set('light');  // 设置为亮色主题
await window.intools.theme.set('system'); // 跟随系统主题
```

**参数**:
- `mode` ('light' | 'dark' | 'system') - 主题模式

**返回值**: `ThemeInfo` - 更新后的主题信息

### 7.3 getActual()
获取实际应用的主题（解析 system 后的结果）。

```javascript
const theme = await window.intools.theme.getActual();
// 返回: 'light' 或 'dark'
```

**返回值**: `'light' | 'dark'`

### 7.4 onThemeChange(callback)
监听主题变化事件。

```javascript
window.intools.onThemeChange((theme) => {
  console.log('主题已变更为:', theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
});
```

**参数**:
- `callback` ((theme: 'light' | 'dark') => void) - 主题变化回调函数

### 7.5 插件中使用主题

#### 获取初始主题

插件 UI 加载时，可通过 URL 参数获取当前主题（仅附着模式）：

```javascript
function getInitialTheme() {
  const params = new URLSearchParams(window.location.search);
  return params.get('theme') || 'light';
}
```

#### 监听主题变化（推荐）

使用 `window.intools.onThemeChange` 监听主题变化，适用于附着模式和独立窗口模式：

```javascript
window.intools?.onThemeChange?.((theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
});
```

### 7.6 完整示例

#### 插件 CSS（使用 CSS 变量支持主题）

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f3f4f6;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --border: #d1d5db;
  --accent: #3B82F6;
}

.dark {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2d2d2d;
  --text-primary: #e0e0e0;
  --text-secondary: #999999;
  --border: #3d3d3d;
  --accent: #3B82F6;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
}
```

#### 插件 React 组件

```tsx
import { useState, useEffect } from 'react';

function getInitialTheme(): 'light' | 'dark' {
  const params = new URLSearchParams(window.location.search);
  return (params.get('theme') as 'light' | 'dark') || 'light';
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  // 应用主题到 document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // 监听主题变化
  useEffect(() => {
    window.intools?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme);
    });
  }, []);

  return (
    <div className="app">
      <p>当前主题: {theme}</p>
    </div>
  );
}
```

## 8. 屏幕 API (screen)

屏幕 API 提供截图、录屏和屏幕信息获取功能，支持 macOS、Windows 和 Linux。

### 8.1 getAllDisplays()
获取所有显示器信息。

```javascript
const displays = await screen.getAllDisplays();
// 返回: DisplayInfo[]
```

**返回值**: `DisplayInfo[]`

```typescript
interface DisplayInfo {
  id: number;           // 显示器 ID
  label: string;        // 显示器名称
  bounds: {             // 显示器边界
    x: number;
    y: number;
    width: number;
    height: number;
  };
  workArea: {           // 可用工作区域（排除任务栏等）
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;  // 缩放因子（如 Retina 为 2）
  rotation: number;     // 旋转角度
  isPrimary: boolean;   // 是否为主显示器
}
```

### 8.2 getPrimaryDisplay()
获取主显示器信息。

```javascript
const primary = await screen.getPrimaryDisplay();
console.log(primary.bounds.width, primary.bounds.height);
```

**返回值**: `DisplayInfo`

### 8.3 getDisplayNearestPoint(point)
获取指定坐标位置的显示器。

```javascript
const display = await screen.getDisplayNearestPoint({ x: 100, y: 100 });
```

**参数**:
- `point` ({ x: number; y: number }) - 屏幕坐标

**返回值**: `DisplayInfo`

### 8.4 getCursorScreenPoint()
获取鼠标当前位置。

```javascript
const cursor = await screen.getCursorScreenPoint();
console.log(`鼠标位置: ${cursor.x}, ${cursor.y}`);
```

**返回值**: `{ x: number; y: number }`

### 8.5 getSources(options?)
获取可捕获的屏幕和窗口源列表。

```javascript
// 获取所有屏幕和窗口
const sources = await screen.getSources();

// 只获取屏幕
const screens = await screen.getSources({ types: ['screen'] });

// 只获取窗口
const windows = await screen.getSources({ types: ['window'] });

// 自定义缩略图大小
const sources = await screen.getSources({
  types: ['screen', 'window'],
  thumbnailSize: { width: 300, height: 300 }
});
```

**参数** (CaptureOptions):
- `types` (('screen' | 'window')[], 可选) - 捕获类型，默认 ['screen', 'window']
- `thumbnailSize` ({ width: number; height: number }, 可选) - 缩略图大小，默认 150x150

**返回值**: `CaptureSource[]`

```typescript
interface CaptureSource {
  id: string;              // 源 ID（用于截图/录屏）
  name: string;            // 源名称
  thumbnailDataUrl: string; // 缩略图 Data URL
  displayId?: string;      // 关联的显示器 ID
  appIconDataUrl?: string; // 应用图标 Data URL（仅窗口）
}
```

### 8.6 capture(options?)
截取屏幕截图。

```javascript
// 截取主屏幕
const buffer = await screen.capture();
filesystem.writeFile('/tmp/screenshot.png', buffer);

// 截取指定源
const sources = await screen.getSources({ types: ['screen'] });
const buffer = await screen.capture({ sourceId: sources[0].id });

// 输出为 JPEG 格式
const jpegBuffer = await screen.capture({
  format: 'jpeg',
  quality: 80
});
```

**参数** (ScreenshotOptions):
- `sourceId` (string, 可选) - 捕获源 ID，不指定则截取主屏幕
- `format` ('png' | 'jpeg', 可选) - 输出格式，默认 'png'
- `quality` (number, 可选) - JPEG 质量 0-100，默认 90

**返回值**: `Buffer` - 图片数据

### 8.7 captureRegion(region, options?)
截取屏幕指定区域。

```javascript
// 截取指定区域
const buffer = await screen.captureRegion({
  x: 100,
  y: 100,
  width: 800,
  height: 600
});

// 输出为 JPEG
const buffer = await screen.captureRegion(
  { x: 0, y: 0, width: 1920, height: 1080 },
  { format: 'jpeg', quality: 85 }
);
```

**参数**:
- `region` ({ x, y, width, height }) - 截取区域（屏幕坐标）
- `options` (可选):
  - `format` ('png' | 'jpeg') - 输出格式
  - `quality` (number) - JPEG 质量

**返回值**: `Buffer` - 图片数据

### 8.8 getMediaStreamConstraints(options)
获取录屏所需的 MediaStream 约束配置。

```javascript
const constraints = await screen.getMediaStreamConstraints({
  sourceId: 'screen:0:0',
  audio: true,
  frameRate: 30
});

// 在渲染进程中使用
const stream = await navigator.mediaDevices.getUserMedia(constraints);
const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
```

**参数** (RecordingOptions):
- `sourceId` (string, 必需) - 捕获源 ID
- `audio` (boolean, 可选) - 是否录制音频，默认 false
- `frameRate` (number, 可选) - 帧率，默认 30

**返回值**: `object` - MediaStream 约束配置

### 8.9 完整示例

#### 截图插件示例

```javascript
module.exports = {
  async run(context) {
    const { screen, filesystem, notification, clipboard } = context.api;

    try {
      // 获取所有显示器
      const displays = await screen.getAllDisplays();
      notification.show(`检测到 ${displays.length} 个显示器`);

      // 截取主屏幕
      const buffer = await screen.capture({ format: 'png' });

      // 保存到文件
      const path = `/tmp/screenshot_${Date.now()}.png`;
      filesystem.writeFile(path, buffer);

      // 复制到剪贴板
      clipboard.writeImage(buffer);

      notification.show('截图已保存并复制到剪贴板');
    } catch (error) {
      notification.show('截图失败: ' + error.message, 'error');
    }
  }
};
```

#### 录屏插件示例（UI 部分）

```javascript
// 在插件 UI 中使用
async function startRecording() {
  // 获取屏幕源
  const sources = await window.intools.screen.getSources({ types: ['screen'] });

  // 获取 MediaStream 约束
  const constraints = await window.intools.screen.getMediaStreamConstraints({
    sourceId: sources[0].id,
    audio: true,
    frameRate: 30
  });

  // 创建 MediaStream
  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  // 创建录制器
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    // 处理录制的视频...
  };

  recorder.start();
}
```

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

## 10. Dialog API (dialog)

Dialog API 提供系统原生对话框，支持 macOS、Windows 和 Linux。

### 10.1 showOpenDialog(options?)
显示打开文件对话框。

```javascript
// 选择单个文件
const files = await dialog.showOpenDialog();

// 选择多个文件
const files = await dialog.showOpenDialog({
  title: '选择文件',
  properties: ['openFile', 'multiSelections']
});

// 选择目录
const dirs = await dialog.showOpenDialog({
  properties: ['openDirectory']
});

// 带文件过滤器
const images = await dialog.showOpenDialog({
  title: '选择图片',
  filters: [
    { name: '图片', extensions: ['jpg', 'png', 'gif'] },
    { name: '所有文件', extensions: ['*'] }
  ]
});
```

**参数** (OpenDialogOptions):
- `title` (string, 可选) - 对话框标题
- `defaultPath` (string, 可选) - 默认路径
- `buttonLabel` (string, 可选) - 确认按钮文字
- `filters` (array, 可选) - 文件过滤器
- `properties` (array, 可选) - 属性：
  - `'openFile'` - 允许选择文件
  - `'openDirectory'` - 允许选择目录
  - `'multiSelections'` - 允许多选
  - `'showHiddenFiles'` - 显示隐藏文件

**返回值**: `string[]` - 选中的文件路径数组，取消时返回空数组

### 10.2 showSaveDialog(options?)
显示保存文件对话框。

```javascript
const savePath = await dialog.showSaveDialog({
  title: '保存文件',
  defaultPath: 'untitled.txt',
  filters: [
    { name: '文本文件', extensions: ['txt'] }
  ]
});

if (savePath) {
  filesystem.writeFile(savePath, content);
}
```

**参数** (SaveDialogOptions):
- `title` (string, 可选) - 对话框标题
- `defaultPath` (string, 可选) - 默认文件名或路径
- `buttonLabel` (string, 可选) - 确认按钮文字
- `filters` (array, 可选) - 文件过滤器

**返回值**: `string | null` - 保存路径，取消时返回 null

### 10.3 showMessageBox(options)
显示消息框。

```javascript
// 简单消息
await dialog.showMessageBox({
  message: '操作完成'
});

// 确认对话框
const result = await dialog.showMessageBox({
  type: 'question',
  title: '确认',
  message: '确定要删除吗？',
  buttons: ['取消', '删除'],
  defaultId: 0,
  cancelId: 0
});

if (result.response === 1) {
  // 用户点击了"删除"
}
```

**参数** (MessageBoxOptions):
- `type` (string, 可选) - 类型：'none' | 'info' | 'error' | 'question' | 'warning'
- `title` (string, 可选) - 标题
- `message` (string, 必需) - 消息内容
- `detail` (string, 可选) - 详细信息
- `buttons` (string[], 可选) - 按钮文字数组，默认 ['OK']
- `defaultId` (number, 可选) - 默认选中按钮索引
- `cancelId` (number, 可选) - 取消按钮索引

**返回值**: `{ response: number; checkboxChecked: boolean }`

### 10.4 showErrorBox(title, content)
显示错误框（同步，会阻塞）。

```javascript
dialog.showErrorBox('错误', '发生了一个严重错误');
```

**参数**:
- `title` (string) - 标题
- `content` (string) - 错误内容

## 11. System API (system)

System API 提供系统和应用信息，支持 macOS、Windows 和 Linux。

### 11.1 getSystemInfo()
获取系统信息。

```javascript
const info = await system.getSystemInfo();
console.log(`平台: ${info.platform}`);
console.log(`CPU 核心数: ${info.cpus}`);
console.log(`总内存: ${(info.totalmem / 1024 / 1024 / 1024).toFixed(2)} GB`);
```

**返回值**: `SystemInfo`

```typescript
interface SystemInfo {
  platform: string;    // 'darwin' | 'win32' | 'linux'
  arch: string;        // 'x64' | 'arm64' 等
  hostname: string;    // 主机名
  username: string;    // 当前用户名
  homedir: string;     // 用户主目录
  tmpdir: string;      // 临时目录
  cpus: number;        // CPU 核心数
  totalmem: number;    // 总内存（字节）
  freemem: number;     // 可用内存（字节）
  uptime: number;      // 系统运行时间（秒）
  osVersion: string;   // 操作系统版本
  osRelease: string;   // 操作系统发行版本
}
```

### 11.2 getAppInfo()
获取应用信息。

```javascript
const app = await system.getAppInfo();
console.log(`应用版本: ${app.version}`);
```

**返回值**: `AppInfo`

```typescript
interface AppInfo {
  name: string;        // 应用名称
  version: string;     // 应用版本
  locale: string;      // 系统语言
  isPackaged: boolean; // 是否为打包版本
  userDataPath: string; // 用户数据目录
}
```

### 11.3 getPath(name)
获取系统特定路径。

```javascript
const desktop = await system.getPath('desktop');
const downloads = await system.getPath('downloads');
```

**参数**:
- `name` - 路径名称：'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'

**返回值**: `string`

### 11.4 getEnv(name)
获取环境变量。

```javascript
const path = await system.getEnv('PATH');
const home = await system.getEnv('HOME');
```

**参数**:
- `name` (string) - 环境变量名

**返回值**: `string | undefined`

### 11.5 getIdleTime()
获取系统空闲时间。

```javascript
const idleSeconds = await system.getIdleTime();
if (idleSeconds > 300) {
  console.log('用户已离开超过5分钟');
}
```

**返回值**: `number` - 空闲时间（秒）

## 12. GlobalShortcut API (shortcut)

GlobalShortcut API 允许插件注册全局快捷键，支持 macOS、Windows 和 Linux。

### 12.1 register(accelerator)
注册全局快捷键。

```javascript
const success = await shortcut.register('CommandOrControl+Shift+X');
if (success) {
  console.log('快捷键注册成功');
}
```

**参数**:
- `accelerator` (string) - 快捷键组合

**返回值**: `boolean` - 是否注册成功

**快捷键格式**:
- 修饰键: `Command`(macOS), `Control`, `Alt`, `Shift`, `Meta`
- `CommandOrControl` - macOS 上为 Command，其他平台为 Control
- 示例: `CommandOrControl+X`, `Alt+Shift+P`, `F12`

### 12.2 unregister(accelerator)
注销全局快捷键。

```javascript
await shortcut.unregister('CommandOrControl+Shift+X');
```

**参数**:
- `accelerator` (string) - 快捷键组合

### 12.3 unregisterAll()
注销该插件注册的所有快捷键。

```javascript
await shortcut.unregisterAll();
```

### 12.4 isRegistered(accelerator)
检查快捷键是否已被注册。

```javascript
const registered = await shortcut.isRegistered('CommandOrControl+X');
```

**返回值**: `boolean`

### 12.5 onTriggered(callback)
监听快捷键触发事件（仅插件 UI 中使用）。

```javascript
window.intools.shortcut.onTriggered((accelerator) => {
  console.log(`快捷键 ${accelerator} 被触发`);
});
```

## 13. Security API (security)

Security API 提供安全的加密存储功能，使用系统级加密（macOS Keychain、Windows DPAPI、Linux Secret Service）。

### 13.1 isEncryptionAvailable()
检查加密功能是否可用。

```javascript
const available = await security.isEncryptionAvailable();
if (!available) {
  console.log('当前系统不支持加密存储');
}
```

**返回值**: `boolean`

### 13.2 encryptString(plainText)
加密字符串。

```javascript
const encrypted = await security.encryptString('my-secret-password');
// 存储 encrypted Buffer
```

**参数**:
- `plainText` (string) - 要加密的明文

**返回值**: `Buffer` - 加密后的数据

### 13.3 decryptString(encrypted)
解密字符串。

```javascript
const decrypted = await security.decryptString(encryptedBuffer);
console.log(decrypted); // 'my-secret-password'
```

**参数**:
- `encrypted` (Buffer) - 加密的数据

**返回值**: `string` - 解密后的明文

### 13.4 完整示例

```javascript
module.exports = {
  async run(context) {
    const { security, storage, notification } = context.api;

    // 检查加密是否可用
    if (!security.isEncryptionAvailable()) {
      notification.show('加密不可用', 'error');
      return;
    }

    // 加密并存储 API Key
    const apiKey = 'sk-xxxxxxxxxxxx';
    const encrypted = security.encryptString(apiKey);
    await storage.set('encrypted_api_key', encrypted.toString('base64'));

    // 读取并解密
    const stored = await storage.get('encrypted_api_key');
    const buffer = Buffer.from(stored, 'base64');
    const decrypted = security.decryptString(buffer);

    notification.show('API Key 已安全存储');
  }
};
```

## 14. Media API (media)

Media API 提供摄像头和麦克风的权限管理，支持 macOS、Windows 和 Linux。

### 14.1 getAccessStatus(mediaType)
获取媒体访问权限状态。

```javascript
const status = await media.getAccessStatus('camera');
// macOS 返回: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
// Windows/Linux 返回: 'granted'
```

**参数**:
- `mediaType` ('microphone' | 'camera') - 媒体类型

**返回值**: `string` - 权限状态

**跨平台说明**:
- macOS: 返回实际权限状态
- Windows/Linux: 始终返回 'granted'（权限由浏览器在使用时处理）

### 14.2 askForAccess(mediaType)
请求媒体访问权限。

```javascript
const granted = await media.askForAccess('microphone');
if (granted) {
  // 可以使用麦克风
}
```

**参数**:
- `mediaType` ('microphone' | 'camera') - 媒体类型

**返回值**: `boolean` - 是否获得权限

### 14.3 hasCameraAccess()
检查是否有摄像头权限。

```javascript
if (await media.hasCameraAccess()) {
  // 可以使用摄像头
}
```

**返回值**: `boolean`

### 14.4 hasMicrophoneAccess()
检查是否有麦克风权限。

```javascript
if (await media.hasMicrophoneAccess()) {
  // 可以使用麦克风
}
```

**返回值**: `boolean`

### 14.5 在插件 UI 中使用摄像头/麦克风

权限检查后，在插件 UI 中使用标准 Web API：

```javascript
// 检查权限
const hasCamera = await window.intools.media.hasCameraAccess();
if (!hasCamera) {
  await window.intools.media.askForAccess('camera');
}

// 使用 Web API 获取媒体流
const stream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
});

// 显示视频
const video = document.querySelector('video');
video.srcObject = stream;
```

## 15. Power API (power)

Power API 提供电源和系统状态监控，支持 macOS、Windows 和 Linux。

### 15.1 getSystemIdleTime()
获取系统空闲时间。

```javascript
const idleSeconds = await power.getSystemIdleTime();
console.log(`系统已空闲 ${idleSeconds} 秒`);
```

**返回值**: `number` - 空闲时间（秒）

### 15.2 getSystemIdleState(idleThreshold)
获取系统空闲状态。

```javascript
const state = await power.getSystemIdleState(60);
// 返回: 'active' | 'idle' | 'locked' | 'unknown'
```

**参数**:
- `idleThreshold` (number) - 空闲阈值（秒）

**返回值**: `string` - 空闲状态

### 15.3 isOnBatteryPower()
检查是否使用电池供电。

```javascript
if (await power.isOnBatteryPower()) {
  console.log('当前使用电池供电');
}
```

**返回值**: `boolean`

### 15.4 getCurrentThermalState()
获取当前热状态（仅 macOS）。

```javascript
const thermal = await power.getCurrentThermalState();
// macOS 返回: 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'
// Windows/Linux 返回: 'unknown'
```

**返回值**: `string`

### 15.5 事件监听

```javascript
// 系统休眠
window.intools.power.onSuspend(() => {
  console.log('系统即将休眠');
});

// 系统唤醒
window.intools.power.onResume(() => {
  console.log('系统已唤醒');
});

// 切换到交流电
window.intools.power.onAC(() => {
  console.log('已连接电源');
});

// 切换到电池
window.intools.power.onBattery(() => {
  console.log('已切换到电池供电');
});

// 屏幕锁定
window.intools.power.onLockScreen(() => {
  console.log('屏幕已锁定');
});

// 屏幕解锁
window.intools.power.onUnlockScreen(() => {
  console.log('屏幕已解锁');
});
```

## 16. Tray API (tray)

Tray API 提供系统托盘功能，支持 macOS、Windows 和 Linux。

### 16.1 create(options)
创建系统托盘图标。

```javascript
const success = await tray.create({
  icon: '/path/to/icon.png',  // 或 base64 data URL
  tooltip: '我的插件',
  title: '状态'  // 仅 macOS
});
```

**参数** (TrayOptions):
- `icon` (string) - 图标路径或 base64 data URL
- `tooltip` (string, 可选) - 鼠标悬停提示
- `title` (string, 可选) - 托盘标题（仅 macOS）

**返回值**: `boolean` - 是否创建成功

### 16.2 destroy()
销毁托盘图标。

```javascript
await tray.destroy();
```

### 16.3 setIcon(icon)
更新托盘图标。

```javascript
await tray.setIcon('/path/to/new-icon.png');
```

**参数**:
- `icon` (string) - 图标路径或 base64 data URL

### 16.4 setTooltip(tooltip)
设置鼠标悬停提示。

```javascript
await tray.setTooltip('新的提示文字');
```

### 16.5 setTitle(title)
设置托盘标题（仅 macOS）。

```javascript
await tray.setTitle('运行中');
```

### 16.6 exists()
检查托盘是否存在。

```javascript
if (await tray.exists()) {
  console.log('托盘已创建');
}
```

**返回值**: `boolean`

## 17. Network API (network)

Network API 提供网络状态监控，支持 macOS、Windows 和 Linux。

### 17.1 isOnline()
检查当前是否在线。

```javascript
if (await network.isOnline()) {
  console.log('网络已连接');
}
```

**返回值**: `boolean`

### 17.2 onOnline(callback)
监听网络恢复事件。

```javascript
window.intools.network.onOnline(() => {
  console.log('网络已恢复');
});
```

### 17.3 onOffline(callback)
监听网络断开事件。

```javascript
window.intools.network.onOffline(() => {
  console.log('网络已断开');
});
```

## 18. Menu API (menu)

Menu API 提供原生右键菜单功能，支持 macOS、Windows 和 Linux。

### 18.1 showContextMenu(items)
显示上下文菜单。

```javascript
const selectedId = await menu.showContextMenu([
  { label: '复制', id: 'copy' },
  { label: '粘贴', id: 'paste' },
  { type: 'separator' },
  { label: '设置', id: 'settings', submenu: [
    { label: '选项1', id: 'opt1' },
    { label: '选项2', id: 'opt2' }
  ]}
]);

if (selectedId === 'copy') {
  // 处理复制
}
```

**参数** (MenuItemOptions[]):
- `label` (string) - 菜单项文字
- `type` ('normal' | 'separator' | 'checkbox' | 'radio', 可选)
- `checked` (boolean, 可选) - checkbox/radio 选中状态
- `enabled` (boolean, 可选) - 是否启用，默认 true
- `id` (string, 可选) - 菜单项标识
- `submenu` (MenuItemOptions[], 可选) - 子菜单

**返回值**: `string | null` - 选中的菜单项 id，取消返回 null

## 19. Geolocation API (geolocation)

Geolocation API 提供地理位置功能，支持 macOS、Windows 和 Linux。

### 19.1 getAccessStatus()
获取位置权限状态。

```javascript
const status = await geolocation.getAccessStatus();
// 返回: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
```

**跨平台说明**:
- macOS: 使用 `node-mac-permissions` 获取实际权限状态
- Windows/Linux: 默认返回 'granted'

**返回值**: `string`

### 19.2 requestAccess()
请求位置权限（仅 macOS 有效）。

```javascript
const status = await geolocation.requestAccess();
if (status === 'granted') {
  // 可以获取位置
}
```

**跨平台说明**:
- macOS: 尝试触发系统权限弹窗，如果权限已被拒绝，会打开系统设置
- Windows/Linux: 直接返回当前状态

**返回值**: `string` - 权限状态

### 19.3 canGetPosition()
检查是否可以获取位置。

```javascript
if (await geolocation.canGetPosition()) {
  const pos = await geolocation.getCurrentPosition();
}
```

**返回值**: `boolean`

### 19.4 openSettings()
打开系统位置权限设置。

```javascript
await geolocation.openSettings();
```

**跨平台说明**:
- macOS: 打开 系统偏好设置 > 安全性与隐私 > 定位服务
- Windows: 打开 设置 > 隐私 > 位置
- Linux: 暂不支持

### 19.5 getCurrentPosition()
获取当前位置。

```javascript
try {
  const pos = await geolocation.getCurrentPosition();
  console.log(`纬度: ${pos.latitude}, 经度: ${pos.longitude}`);
} catch (err) {
  console.error('获取位置失败:', err);
}
```

**返回值**: `GeolocationPosition`

```typescript
interface GeolocationPosition {
  latitude: number      // 纬度
  longitude: number     // 经度
  accuracy: number      // 精度（米）
  altitude?: number     // 海拔
  altitudeAccuracy?: number
  heading?: number      // 方向
  speed?: number        // 速度
  timestamp: number     // 时间戳
}
```

### 19.6 完整示例

```javascript
// 推荐的权限检查流程
async function getLocation() {
  // 1. 检查权限状态
  const status = await geolocation.getAccessStatus();
  
  // 2. 处理不同状态
  if (status === 'denied' || status === 'restricted') {
    notification.show('请在系统设置中开启位置权限', 'error');
    await geolocation.openSettings();
    return null;
  }
  
  if (status === 'not-determined') {
    const newStatus = await geolocation.requestAccess();
    if (newStatus !== 'granted') {
      notification.show('位置权限未授权', 'warning');
      return null;
    }
  }
  
  // 3. 获取位置
  try {
    return await geolocation.getCurrentPosition();
  } catch (error) {
    notification.show('获取位置失败: ' + error.message, 'error');
    return null;
  }
}
```

## 20. TTS API (tts)

TTS API 提供语音合成功能，使用 Web Speech API，支持 macOS、Windows 和 Linux。

### 20.1 speak(text, options?)
朗读文本。

```javascript
await tts.speak('你好，世界');

// 带选项
await tts.speak('Hello World', {
  lang: 'en-US',
  rate: 1.2,
  pitch: 1.0,
  volume: 0.8
});
```

**参数**:
- `text` (string) - 要朗读的文本
- `options` (可选):
  - `lang` (string) - 语言代码，如 'zh-CN', 'en-US'
  - `rate` (number) - 语速 0.1-10，默认 1
  - `pitch` (number) - 音调 0-2，默认 1
  - `volume` (number) - 音量 0-1，默认 1

### 20.2 stop()
停止朗读。

```javascript
tts.stop();
```

### 20.3 pause() / resume()
暂停和恢复朗读。

```javascript
tts.pause();
tts.resume();
```

### 20.4 getVoices()
获取可用语音列表。

```javascript
const voices = tts.getVoices();
// [{ name: 'Samantha', lang: 'en-US', default: true, localService: true }, ...]
```

### 20.5 isSpeaking()
检查是否正在朗读。

```javascript
if (tts.isSpeaking()) {
  console.log('正在朗读中');
}
```
