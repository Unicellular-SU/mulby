# FFmpeg 音视频处理 API
本文档描述 FFmpeg 音视频处理 API 的使用方法与接口。

> 入口：`window.mulby.ffmpeg`

FFmpeg API 提供音视频处理能力。需先下载 FFmpeg，再执行命令。

### 基础流程

```javascript
const available = await mulby.ffmpeg.isAvailable();
if (!available) {
  const result = await mulby.ffmpeg.download((progress) => {
    console.log(`${progress.phase}: ${progress.percent}%`);
  });
  if (!result.success) throw new Error(result.error || '下载失败');
}

const version = await mulby.ffmpeg.getVersion();
console.log('FFmpeg 版本:', version);
```

### ffmpeg.run(args[, onProgress])
[Renderer]

执行 FFmpeg 命令。

**参数**:
- `args: string[]` - FFmpeg 命令行参数数组
- `onProgress?: (progress: RunProgress) => void` - 进度回调（可选）

**返回值**: `{ promise, kill, quit }`

```typescript
interface RunProgress {
  bitrate: string
  fps: number
  frame: number
  percent?: number
  q: number | string
  size: string
  speed: string
  time: string
}

interface RunTask {
  promise: Promise<void>
  kill(): void
  quit(): void
}
```

**注意**: 未安装 FFmpeg 时会抛出错误，需要先调用 `download()`。

### 完整示例

#### 视频压缩

```javascript
const task = mulby.ffmpeg.run(
  [
    '-i', '/path/to/input.mp4',
    '-c:v', 'libx264',
    '-crf', '30',
    '-preset', 'fast',
    '-tag:v', 'avc1',
    '-movflags', 'faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-map', '0:v',
    '-map', '0:a?',
    '/path/to/output.mp4'
  ],
  (progress) => {
    console.log('压缩中', progress.percent, '%');
  }
);

await task.promise;
```

#### 视频转 GIF

```javascript
function getConvertToGifArgs(inputVideo, outputGif, fps = 15, width = 200) {
  return [
    '-i', inputVideo,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=[p];[s1][p]paletteuse`,
    '-loop', '0',
    outputGif
  ];
}

const args = getConvertToGifArgs('/path/to/input.mp4', '/path/to/output.gif');
const task = mulby.ffmpeg.run(args, (progress) => {
  console.log('转换中', progress.percent, '%');
});

await task.promise;
```

#### 音频提取

```javascript
const task = mulby.ffmpeg.run([
  '-i', '/path/to/input.mp4',
  '-q:a', '0',
  '-map', 'a',
  '/path/to/output.mp3'
]);

await task.promise;
```

### 其他 API

### ffmpeg.isAvailable()
[Renderer]

检查 FFmpeg 是否已安装。

```javascript
const available = await mulby.ffmpeg.isAvailable();
```

### ffmpeg.getVersion()
[Renderer]

获取 FFmpeg 版本信息。

```javascript
const version = await mulby.ffmpeg.getVersion();
```

### ffmpeg.getPath()
[Renderer]

获取 FFmpeg 可执行文件路径。

```javascript
const path = await mulby.ffmpeg.getPath();
// 未安装时返回 null
```

### ffmpeg.download(onProgress?)
[Renderer]

手动下载 FFmpeg。

```javascript
const result = await mulby.ffmpeg.download((progress) => {
  // progress.phase: 'downloading' | 'extracting' | 'done'
  // progress.percent: 0-100
  console.log(`${progress.phase}: ${progress.percent}%`);
});

if (result.success) {
  console.log('下载完成');
}
```

### 注意事项

1. **下载前置**: 需先下载 FFmpeg，否则 `run()` 会抛错
2. **进度回调**: 需要解析到总时长时才会输出 `percent`
3. **取消操作**: `kill()` 强制终止，`quit()` 优雅退出