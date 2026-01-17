# Media API (media)
本文档描述 Media API (media) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.intools.media`
> - 插件后端：`context.api.media`

Media API 提供摄像头和麦克风的权限管理，支持 macOS、Windows 和 Linux。

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

**返回值**: `string` - 权限状态

**跨平台说明**:
- macOS: 返回实际权限状态
- Windows/Linux: 始终返回 'granted'（权限由浏览器在使用时处理）

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

**返回值**: `boolean` - 是否获得权限

### hasCameraAccess()
[Renderer] [Backend]
检查是否有摄像头权限。

```javascript
if (await media.hasCameraAccess()) {
  // 可以使用摄像头
}
```

**返回值**: `boolean`

### hasMicrophoneAccess()
[Renderer] [Backend]
检查是否有麦克风权限。

```javascript
if (await media.hasMicrophoneAccess()) {
  // 可以使用麦克风
}
```

**返回值**: `boolean`

### 在插件 UI 中使用摄像头/麦克风

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

### 完整示例

```javascript
const granted = await window.intools.media.askForAccess('microphone');
console.log('microphone:', granted);
```