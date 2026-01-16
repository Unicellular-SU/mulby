# FFmpeg 音视频处理 API

FFmpeg API 提供强大的音视频处理能力，包括视频压缩、格式转换、音频提取、录屏等。首次调用时自动下载 FFmpeg。

## 自动安装

首次调用 `runFFmpeg` 时，若检测到 FFmpeg 未安装，会自动引导下载并集成。也可手动触发下载：

```javascript
// 检查是否已安装
const available = await intools.ffmpeg.isAvailable()

if (!available) {
  // 下载 FFmpeg（带进度回调）
  await intools.ffmpeg.download((progress) => {
    console.log(`${progress.phase}: ${progress.percent}%`)
  })
}

// 获取版本信息
const version = await intools.ffmpeg.getVersion()
console.log('FFmpeg 版本:', version)
```

## ffmpeg.run(args[, onProgress])

执行 FFmpeg 命令。

**参数**:
- `args: string[]` - FFmpeg 命令行参数数组
- `onProgress?: (progress: RunProgress) => void` - 进度回调（可选）

**返回值**: `PromiseLike<void>` - 扩展的 Promise，包含 `kill()` 和 `quit()` 方法

### 类型定义

```typescript
interface RunProgress {
  bitrate: string   // 比特率
  fps: number       // 帧率
  frame: number     // 已处理帧数
  percent?: number  // 完成百分比
  q: number | string // 质量指标
  size: string      // 输出大小
  speed: string     // 处理速度
  time: string      // 已处理时间
}

interface PromiseLike extends Promise<void> {
  kill(): void  // 强制终止
  quit(): void  // 优雅退出（类似按 q 键）
}
```

## 示例代码

### 视频压缩

```javascript
intools.ffmpeg.run(
  [
    "-i", "/path/to/input.mp4",
    "-c:v", "libx264",
    "-crf", "30",
    "-preset", "fast",
    "-tag:v", "avc1",
    "-movflags", "faststart",
    "-c:a", "aac",
    "-b:a", "128k",
    "-map", "0:v",
    "-map", "0:a?",
    "/path/to/output.mp4"
  ],
  (progress) => {
    console.log("压缩中 " + progress.percent + "%")
  }
).then(() => {
  console.log("压缩完成")
}).catch((error) => {
  console.log("出错了：" + error.message)
})
```

### 视频转 GIF

```javascript
function getConvertToGifArgs(inputVideo, outputGif, fps = 15, width = 200) {
  return [
    '-i', inputVideo,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=[p];[s1][p]paletteuse`,
    '-loop', '0',
    outputGif
  ]
}

const args = getConvertToGifArgs('/path/to/input.mp4', '/path/to/output.gif')
const task = intools.ffmpeg.run(args, (progress) => {
  console.log('转换中 ' + progress.percent + '%')
})

task.then(() => console.log('转换完成'))

// 需要取消时
task.kill()
```

### 音频提取

```javascript
await intools.ffmpeg.run([
  "-i", "/path/to/input.mp4",
  "-q:a", "0",
  "-map", "a",
  "/path/to/output.mp3"
])
console.log("提取完成")
```

### 获取视频信息

```javascript
intools.ffmpeg.run(["-i", "/path/to/source.mp4"]).catch((error) => {
  // 根据返回的错误信息提取，error.message 信息示例：
  /*
  Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/path/to/source.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf61.7.100
  Duration: 00:00:07.00, start: 0.000000, bitrate: 2002 kb/s
  Stream #0:0[0x1](und): Video: h264 (High 4:4:4 Predictive) (avc1 / 0x31637661), yuv444p(tv, smpte170m/bt470bg/smpte170m, progressive), 720x1280, 1926 kb/s, 10 fps, 10 tbr, 10240 tbn (default)
      Metadata:
        handler_name    : VideoHandler
        vendor_id       : [0][0][0][0]
        encoder         : Lavc61.19.101 libx264
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 70 kb/s (default)
      Metadata:
        handler_name    : SoundHandler
        vendor_id       : [0][0][0][0]
At least one output file must be specified
  */
  const videoStream = error.message.match(/Stream #\d+:\d+.*Video: ([^\n]+)/)
  const audioStream = error.message.match(/Stream #\d+:\d+.*Audio: ([^\n]+)/)
  const durationMatch = error.message.match(/Duration: ([^,]+)/)
  const bitrateMatch = error.message.match(/bitrate:\s*(\d+ kb\/s)/)
  
  const videoMetadata = {
    duration: durationMatch?.[1] || null,
    bitrate: bitrateMatch?.[1] || null,
    video: videoStream?.[1] || null,
    audio: audioStream?.[1] || null,
  }
  console.log(videoMetadata)
})
```

## 其他 API

### ffmpeg.isAvailable()

检查 FFmpeg 是否已安装。

```javascript
const available = await intools.ffmpeg.isAvailable()
```

### ffmpeg.getVersion()

获取 FFmpeg 版本信息。

```javascript
const version = await intools.ffmpeg.getVersion()
// 例: "7.1"
```

### ffmpeg.getPath()

获取 FFmpeg 可执行文件路径。

```javascript
const path = await intools.ffmpeg.getPath()
// 例: "/Users/xxx/Library/Application Support/InTools/ffmpeg/bin/ffmpeg"
```

### ffmpeg.download(onProgress?)

手动下载 FFmpeg。

```javascript
const result = await intools.ffmpeg.download((progress) => {
  // progress.phase: 'downloading' | 'extracting' | 'done'
  // progress.percent: 0-100
  console.log(`${progress.phase}: ${progress.percent}%`)
})

if (result.success) {
  console.log('下载完成')
}
```

## 注意事项

1. **自动下载**: 首次调用时自动下载，无需手动安装
2. **进度回调**: 需要知道总时长才能计算 `percent`，否则为 `undefined`
3. **取消操作**: 使用 `kill()` 强制终止，`quit()` 优雅退出
4. **跨平台**: 支持 macOS (arm64/x64)、Windows (x64)、Linux (x64)
