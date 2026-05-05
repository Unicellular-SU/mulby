# Media API (media)
本文档描述 Media API (media) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.media`
> - 插件后端：`context.api.media`

Media API 提供摄像头和麦克风的权限管理，支持 macOS、Windows 和 Linux。

插件必须在 `manifest.json` 中声明对应媒体权限，否则宿主会拒绝访问：

```json
{
  "permissions": {
    "microphone": true,
    "camera": true
  }
}
```

桌面录制不是摄像头采集：`chromeMediaSource: 'desktop'` 或 `screen.getMediaStreamConstraints()` 生成的桌面视频流需要 `permissions.screen`，不需要 `permissions.camera`。录制时如果同时请求音频，还需要 `permissions.microphone`。

### getAccessStatus(mediaType)
[Renderer] [Backend]
获取媒体访问权限状态。

```javascript
const status = await media.getAccessStatus('camera');
// macOS 返回: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
// Windows/Linux 返回: 'granted'
```

**参数**:
- `mediaType` ('microphone' | 'camera') - 媒体类型

**返回值**: `string`（插件后端返回 `Promise<string>`） - 权限状态

**跨平台说明**:
- macOS: 返回实际权限状态
- Windows/Linux: 始终返回 'granted'（权限由浏览器在使用时处理）
- 插件未声明对应 `permissions.microphone` / `permissions.camera` 时抛出 `Plugin "<pluginId>" lacks manifest.permissions.<permission>`；声明存在但系统拒绝时返回 `denied`

### askForAccess(mediaType)
[Renderer] [Backend]
请求媒体访问权限。

```javascript
const granted = await media.askForAccess('microphone');
if (granted) {
  // 可以使用麦克风
}
```

**参数**:
- `mediaType` ('microphone' | 'camera') - 媒体类型

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`） - 是否获得权限

插件未声明对应权限时会抛出明确的缺失权限错误；声明存在但系统拒绝时返回 `false`。

### hasCameraAccess()
[Renderer] [Backend]
检查是否有摄像头权限。

```javascript
if (await media.hasCameraAccess()) {
  // 可以使用摄像头
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### hasMicrophoneAccess()
[Renderer] [Backend]
检查是否有麦克风权限。

```javascript
if (await media.hasMicrophoneAccess()) {
  // 可以使用麦克风
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### 在插件 UI 中使用摄像头/麦克风

权限检查后，在插件 UI 中使用标准 Web API。Mulby 只负责权限检查与授权，录音数据由 `navigator.mediaDevices.getUserMedia` 和 `MediaRecorder` 读取。

```javascript
// manifest.json 需要声明:
// { "permissions": { "microphone": true, "camera": true } }

// 检查权限
const hasCamera = await window.mulby.media.hasCameraAccess();
if (!hasCamera) {
  await window.mulby.media.askForAccess('camera');
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

### 完整示例

```javascript
// manifest.json 需要声明:
// { "permissions": { "microphone": true } }

const granted = await window.mulby.media.askForAccess('microphone');
console.log('microphone:', granted);

if (granted) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  recorder.start();
}
```
