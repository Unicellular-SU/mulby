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
