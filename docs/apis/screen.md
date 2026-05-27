# 屏幕 API (screen)
本文档描述 屏幕 API (screen) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.screen`
> - 插件后端：`context.api.screen`

屏幕 API 提供截图、录屏和屏幕信息获取功能，支持 macOS、Windows 和 Linux。

调用捕获类 API 前，插件必须在 `manifest.json` 中声明屏幕权限：

```json
{
  "permissions": {
    "screen": true
  }
}
```

受此权限保护的能力包括 `getSources()`、`getWindowBounds()`、`capture()`、`captureRegion()`、`getMediaStreamConstraints()`、`screenCapture()`、`colorPick()`，以及这些约束触发的桌面录制 `getUserMedia`。普通摄像头 `getUserMedia({ video: true })` 仍使用 `permissions.camera`，桌面录制视频流使用 `permissions.screen`。

### getAllDisplays()
[Renderer] [Backend]
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

### getPrimaryDisplay()
[Renderer] [Backend]
获取主显示器信息。

```javascript
const primary = await screen.getPrimaryDisplay();
console.log(primary.bounds.width, primary.bounds.height);
```

**返回值**: `DisplayInfo`

### getDisplayNearestPoint(point)
[Renderer] [Backend]
获取指定坐标位置的显示器。

```javascript
const display = await screen.getDisplayNearestPoint({ x: 100, y: 100 });
```

**参数**:
- `point` ({ x: number; y: number }) - 屏幕坐标

**返回值**: `DisplayInfo`

### getDisplayMatching(rect)
[Renderer]
获取包含指定矩形区域的显示器。

```javascript
const display = await screen.getDisplayMatching({ x: 0, y: 0, width: 800, height: 600 });
```

**参数**:
- `rect` ({ x: number; y: number; width: number; height: number })

**返回值**: `DisplayInfo`

### getCursorScreenPoint()
[Renderer] [Backend]
获取鼠标当前位置。

```javascript
const cursor = await screen.getCursorScreenPoint();
console.log(`鼠标位置: ${cursor.x}, ${cursor.y}`);
```

**返回值**: `{ x: number; y: number }`

### getSources(options?)
[Renderer] [Backend]
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
  thumbnailSize: { width: 300, height: 300 },
  fetchWindowIcons: false
});
```

**参数** (CaptureOptions):
- `types` (('screen' | 'window')[], 可选) - 捕获类型，默认 ['screen', 'window']
- `thumbnailSize` ({ width: number; height: number }, 可选) - 缩略图大小，默认 150x150
- `fetchWindowIcons` (boolean, 可选) - 是否获取窗口应用图标；默认在请求窗口源时开启，设置为 `false` 可减少窗口源枚举耗时。

**返回值**: `CaptureSource[]`

```typescript
interface CaptureSource {
  id: string;              // 源 ID（用于截图/录屏）
  name: string;            // 源名称
  thumbnailDataUrl: string; // 缩略图 Data URL
  displayId?: string;      // 关联的显示器 ID
  appIconDataUrl?: string; // 应用图标 Data URL（仅窗口）
  bounds?: {               // 窗口边界（窗口源，macOS 原生支持）
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

`bounds` 与 `screen.getAllDisplays().bounds`、`inputMonitor` 鼠标事件使用同一套屏幕逻辑坐标。多显示器场景可能出现负坐标。Windows/Linux 或无法解析窗口边界时，该字段会省略。

### getWindowBounds(sourceId)
[Renderer] [Backend]
获取指定窗口捕获源的当前边界。适合窗口移动或缩放后刷新鼠标轨迹映射。

```javascript
const windows = await screen.getSources({ types: ['window'] });
const bounds = await screen.getWindowBounds(windows[0].id);

if (bounds) {
  console.log(bounds.x, bounds.y, bounds.width, bounds.height);
}
```

**参数**:
- `sourceId` (string) - `getSources()` 返回的窗口源 ID

**返回值**: `{ x: number; y: number; width: number; height: number } | null`

当前 macOS 原生支持窗口边界查询。非窗口源、窗口已不可见、原生模块不可用或平台暂不支持时返回 `null`。

### capture(options?)
[Renderer] [Backend]
截取屏幕截图。

```javascript
// 截取主屏幕
const buffer = await screen.capture();
await filesystem.writeFile('/tmp/screenshot.png', buffer);

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

**返回值**: `Buffer | Uint8Array` - 图片数据

### captureRegion(region, options?)
[Renderer] [Backend]
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

**返回值**: `Buffer | Uint8Array` - 图片数据

### getMediaStreamConstraints(options)
[Renderer] [Backend]
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
- `audio` (boolean, 可选) - 是否录制音频，默认 false。设为 true 时除 `permissions.screen` 外还需要 `permissions.microphone`
- `frameRate` (number, 可选) - 帧率，默认 30

**返回值**: `object` - MediaStream 约束配置

插件未声明 `permissions.screen` 时会抛出 `Plugin "<pluginId>" lacks manifest.permissions.screen`。系统层拒绝屏幕录制时，宿主会记录或返回 `Screen recording permission denied by system`。

### screenCapture()
[Renderer]
交互式区域截图，返回 PNG Data URL。

```javascript
const dataUrl = await screen.screenCapture();
if (dataUrl) {
  // dataUrl 形如 data:image/png;base64,...
}
```

**返回值**: `string | null`

### preCapture 元数据
[Renderer]
当插件功能在 `manifest.json` 中声明 `preCapture: 'region' | 'fullscreen'` 时，宿主会在打开插件窗口前完成截图，并把截图作为 `attachments[0]` 注入 `window.mulby.onPluginInit()`。

```typescript
interface InputAttachment {
  kind: 'image'
  dataUrl: string
  capture?: {
    type: 'region' | 'fullscreen'
    region?: {
      x: number
      y: number
      width: number
      height: number
      displayId?: number
      scaleFactor?: number
    }
    display?: {
      id: number
      bounds: { x: number; y: number; width: number; height: number }
      workArea: { x: number; y: number; width: number; height: number }
      scaleFactor: number
      isPrimary: boolean
    }
  }
}
```

`region` 使用屏幕逻辑坐标，可直接配合 `window.setBounds()` 或 manifest `window.position: 'capture-region'` 使用。macOS 区域截图会优先使用系统 `screencapture` 原生 UI，因此当前可能只返回图片而没有区域坐标；插件必须对 `capture.region` 缺失做居中或手动定位回退，避免平台截图能力降级时无法打开编辑器。

### colorPick()
[Renderer]
屏幕取色，返回颜色信息。

```javascript
const color = await screen.colorPick();
// { hex: '#FF00FF', rgb: 'rgb(255, 0, 255)', r: 255, g: 0, b: 255 }
```

**返回值**: `ColorPickResult | null`

```typescript
interface ColorPickResult {
  hex: string;
  rgb: string;
  r: number;
  g: number;
  b: number;
}
```

### screenToDipPoint(point)
[Renderer] [Backend]
屏幕物理坐标转 DIP 坐标。

```javascript
const dipPoint = await screen.screenToDipPoint({ x: 200, y: 200 });
```

**参数**:
- `point` ({ x: number; y: number }) - 物理屏幕坐标

**返回值**: `{ x: number; y: number }`

### dipToScreenPoint(point)
[Renderer] [Backend]
DIP 坐标转屏幕物理坐标。

```javascript
const screenPoint = await screen.dipToScreenPoint({ x: 200, y: 200 });
```

**参数**:
- `point` ({ x: number; y: number }) - DIP 坐标

**返回值**: `{ x: number; y: number }`

### screenToDipRect(rect)
[Renderer] [Backend]
屏幕物理区域转 DIP 区域。

```javascript
const dipRect = await screen.screenToDipRect({ x: 0, y: 0, width: 200, height: 200 });
```

**参数**:
- `rect` ({ x: number; y: number; width: number; height: number }) - 物理区域

**返回值**: `{ x: number; y: number; width: number; height: number }`

### dipToScreenRect(rect)
[Renderer] [Backend]
DIP 区域转屏幕物理区域。

```javascript
const screenRect = await screen.dipToScreenRect({ x: 0, y: 0, width: 200, height: 200 });
```

**参数**:
- `rect` ({ x: number; y: number; width: number; height: number }) - DIP 区域

**返回值**: `{ x: number; y: number; width: number; height: number }`

> DIP (Device Independent Pixels) 坐标在高 DPI 屏幕上与物理像素不同。macOS Retina 屏上 1 DIP = 2 物理像素。这些方法主要用于跨进程或原生模块场景的坐标精确转换。

### 完整示例

#### 截图插件示例

```javascript
module.exports = {
  async run(context) {
    const { screen, filesystem, notification, clipboard } = context.api;

    try {
      const buffer = await screen.capture({ format: 'png' });
      const path = `/tmp/screenshot_${Date.now()}.png`;
      await filesystem.writeFile(path, buffer);
      clipboard.writeImage(buffer);
      await notification.show('截图已保存并复制到剪贴板');
    } catch (error) {
      await notification.show('截图失败: ' + error.message, 'error');
    }
  }
};
```
