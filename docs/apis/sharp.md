# Sharp 图像处理 API
本文档描述 Sharp 图像处理 API 的使用方法与接口。

> 前端入口：`window.mulby.sharp`
> 后端插件入口：`context.api.sharp.execute`

Sharp API 提供高性能的图像处理功能，包括缩放、裁剪、旋转、格式转换等。基于 [sharp](https://sharp.pixelplumbing.com/) 库实现。

插件后端应调用宿主应用提供的 Sharp API，不需要、也不应该在插件包内打包 native `sharp` 依赖。这样同一个插件包可以在 macOS、Windows、Linux 上复用，由宿主应用负责加载对应平台的 Sharp 运行时。

### 基本用法

```javascript
// 调整尺寸
const buffer = await mulby.sharp('/path/to/image.jpg')
  .resize(200, 200)
  .toBuffer()

// 链式操作
const buffer = await mulby.sharp('/path/to/image.jpg')
  .resize(300, 300, { fit: 'cover' })
  .grayscale()
  .blur(2)
  .toBuffer()

// 格式转换
await mulby.sharp('/path/to/input.png')
  .jpeg({ quality: 80 })
  .toFile('/path/to/output.jpg')
```

### sharp(input?, options?)
[Renderer]

创建 Sharp 实例。

**参数**:
- `input` - 图片输入，支持以下类型：
  - `string` - 文件路径
  - `Buffer` / `ArrayBuffer` / `Uint8Array` - 二进制数据
  - `{ create: { width, height, channels, background } }` - 创建空白图像
  - `{ text: { text, width?, height? } }` - 创建文本图像
- `options` - Sharp 选项（可选）

### execute(payload)
[Backend]

在插件后端执行序列化的 Sharp 操作链。该接口用于没有渲染进程的后台任务、批处理、文件处理流水线等场景。

```javascript
const result = await context.api.sharp.execute({
  input: '/path/to/input.jpg',
  operations: [
    { method: 'resize', args: [300, 300, { fit: 'cover' }] },
    { method: 'webp', args: [{ quality: 82 }] },
    { method: 'toBuffer', args: [] }
  ]
})

const buffer = Buffer.from(new Uint8Array(result))
```

**参数**:
- `input` - 图片输入，支持文件路径、`ArrayBuffer`、`Uint8Array`、Buffer-like 对象，以及 Sharp 的对象输入（如 `{ create: ... }`）。
- `options` - Sharp 构造选项（可选）。
- `operations` - 操作链数组，每项格式为 `{ method, args }`。

**返回值**:
- `toBuffer()` 返回 `ArrayBuffer`。
- `toBuffer({ resolveWithObject: true })` 返回对象，其中 `data` 会被序列化为 `ArrayBuffer`。
- `toFile()`、`metadata()`、`stats()` 返回可序列化对象。

**终结方法**:
- `toBuffer`
- `toFile`
- `metadata`
- `stats`

其他 Sharp 方法会按链式方法处理，例如 `raw().toBuffer()` 中的 `raw` 是链式方法，`toBuffer` 才是终结方法。

### 尺寸调整方法

### resize(width?, height?, options?)
[Renderer]

调整图像尺寸。

```javascript
// 固定尺寸
.resize(200, 200)

// 只设置宽度，高度按比例
.resize(200)

// 使用选项
.resize(200, 200, { 
  fit: 'cover',      // cover | contain | fill | inside | outside
  position: 'center', // 位置
  background: '#fff'  // 背景色
})
```

### extract({ left, top, width, height })
[Renderer]

裁剪图像区域。

```javascript
.extract({ left: 10, top: 10, width: 100, height: 100 })
```

### extend(options)
[Renderer]

扩展图像画布。

```javascript
.extend({ top: 10, bottom: 10, left: 20, right: 20, background: '#fff' })
```

### trim(options?)
[Renderer]

自动裁剪边缘空白。

```javascript
.trim({ threshold: 10 })
```

### 变换方法

### rotate(angle?, options?)
[Renderer]

旋转图像。

```javascript
.rotate(90)  // 旋转 90 度
.rotate()    // 根据 EXIF 自动旋转
```

### flip() / flop()
[Renderer]

垂直翻转 / 水平翻转。

```javascript
.flip()  // 垂直翻转
.flop()  // 水平翻转
```

### affine(matrix, options?)
[Renderer]

应用仿射变换。

```javascript
.affine([[1, 0.2], [0.1, 1]], { background: '#fff' })
```

### 图像处理方法

### median(size?)
[Renderer]

应用中值滤波。

```javascript
.median(3)
```

### blur(sigma?)
[Renderer]

模糊处理。

```javascript
.blur(5)  // sigma 0.3-1000
```

### sharpen(options?)
[Renderer]

锐化处理。

```javascript
.sharpen()
.sharpen({ sigma: 2 })
```

### flatten(options?)
[Renderer]

移除 alpha 通道并合成到背景色。

```javascript
.flatten({ background: '#fff' })
```

### grayscale() / greyscale()
[Renderer]

转换为灰度图。

```javascript
.grayscale()
```

### negate(options?)
[Renderer]

反相处理。

```javascript
.negate()
```

### gamma(gamma?)
[Renderer]

伽马校正。

```javascript
.gamma(2.2)
```

### normalise(options?) / normalize(options?)
[Renderer]

增强图像对比度。

```javascript
.normalise()
.normalize({ lower: 1, upper: 99 })
```

### clahe(options)
[Renderer]

应用自适应直方图均衡。

```javascript
.clahe({ width: 32, height: 32 })
```

### convolve(kernel)
[Renderer]

应用卷积核。

```javascript
.convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
```

### threshold(threshold?, options?)
[Renderer]

二值化处理。

```javascript
.threshold(128)
```

### modulate(options?)
[Renderer]

调整亮度、饱和度、色相。

```javascript
.modulate({
  brightness: 1.2,  // 亮度
  saturation: 0.8,  // 饱和度
  hue: 180          // 色相偏移
})
```

### linear(a?, b?) / recomb(matrix)
[Renderer]

调整通道线性参数或应用通道重组矩阵。

```javascript
.linear(1.1, -10)
.recomb([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
```

### tint(color)
[Renderer]

着色处理。

```javascript
.tint({ r: 255, g: 0, b: 0 })
.tint('#ff0000')
```

### pipelineColorspace(colorspace?) / toColorspace(colorspace?)
[Renderer]

设置流水线或输出颜色空间。

```javascript
.pipelineColorspace('rgb16')
.toColorspace('srgb')
```

### removeAlpha() / ensureAlpha(alpha?)
[Renderer]

移除或确保 alpha 通道。

```javascript
.removeAlpha()
.ensureAlpha(1)
```

### extractChannel(channel) / joinChannel(input, options?)
[Renderer]

提取或追加图像通道。

```javascript
.extractChannel('red')
.joinChannel(alphaBuffer, { raw: { width, height, channels: 1 } })
```

### bandbool(boolOp)
[Renderer]

对通道应用布尔运算。

```javascript
.bandbool('and')
```

### 合成方法

### composite(images)
[Renderer]

图像合成。

```javascript
.composite([{
  input: '/path/to/overlay.png',
  gravity: 'southeast',  // 位置
  blend: 'over'          // 混合模式
}])
```

### 输出格式方法

### png(options?) / jpeg(options?) / webp(options?) / gif(options?) / tiff(options?) / avif(options?) / heif(options?) / raw(options?)
[Renderer]

设置输出格式。

```javascript
.png({ compressionLevel: 9 })
.jpeg({ quality: 80, progressive: true })
.webp({ quality: 75, lossless: false })
.heif({ quality: 80 })
.raw()
```

### withMetadata(options?) / keepExif() / withExif(exif) / keepIccProfile() / withIccProfile(icc)
[Renderer]

控制输出元数据、EXIF 和 ICC profile。

```javascript
.withMetadata()
.keepExif()
.withExif({ IFD0: { Copyright: 'Mulby' } })
.keepIccProfile()
.withIccProfile('p3')
```

### timeout(options)
[Renderer]

设置 Sharp 操作超时。

```javascript
.timeout({ seconds: 10 })
```

### tile(options?)
[Renderer]

输出深度缩放图像瓦片。

```javascript
.tile({ size: 256 })
```

### clone()
[Renderer]

复制当前操作链构建器。

```javascript
const base = mulby.sharp('/path/to/image.jpg').resize(300)
const png = await base.clone().png().toBuffer()
const webp = await base.clone().webp().toBuffer()
```

### 终结方法

### toBuffer(options?)
[Renderer]

输出为 ArrayBuffer（渲染进程）。

```javascript
const buffer = await sharp('/path/to/image.jpg')
  .resize(200, 200)
  .toBuffer()

// 如需 Buffer:
const nodeBuffer = Buffer.from(new Uint8Array(buffer))
```

### toFile(path)
[Renderer]

输出到文件。

```javascript
const info = await sharp('/path/to/input.jpg')
  .resize(200, 200)
  .toFile('/path/to/output.jpg')

// info: { format, width, height, channels, size }
```

### metadata()
[Renderer]

获取图像元数据。

```javascript
const meta = await sharp('/path/to/image.jpg').metadata()
// {
//   format: 'jpeg',
//   width: 1920,
//   height: 1080,
//   channels: 3,
//   space: 'srgb',
//   depth: 'uchar',
//   hasAlpha: false,
//   ...
// }
```

### stats()
[Renderer]

获取图像统计信息。

```javascript
const stats = await sharp('/path/to/image.jpg').stats()
// { channels, isOpaque, entropy, sharpness, dominant }
```

### 创建空白图像

```javascript
const buffer = await mulby.sharp({
  create: {
    width: 200,
    height: 200,
    channels: 4,
    background: { r: 59, g: 130, b: 246, alpha: 1 }
  }
}).png().toBuffer()
```

### getSharpVersion()
[Renderer]

获取 Sharp 版本信息。

```javascript
const version = await mulby.getSharpVersion()
// { sharp: { vips: '...', sharp: '...' }, format: { ... } }
```

### 完整示例

#### 图片处理插件

```javascript
// 批量处理图片
async function processImages(paths) {
  for (const path of paths) {
    // 获取元数据
    const meta = await mulby.sharp(path).metadata()
    console.log(`处理: ${path} (${meta.width}x${meta.height})`)
    
    // 生成缩略图
    await mulby.sharp(path)
      .resize(150, 150, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(path.replace(/\.\w+$/, '_thumb.jpg'))
  }
}

// 添加水印
async function addWatermark(imagePath, watermarkPath, outputPath) {
  await mulby.sharp(imagePath)
    .composite([{
      input: watermarkPath,
      gravity: 'southeast'
    }])
    .toFile(outputPath)
}
```

#### 注意事项

1. **链式调用**: 所有方法都返回构建器对象，支持链式调用
2. **异步操作**: 终结方法（`toBuffer`, `toFile`, `metadata`, `stats`）返回 Promise
3. **内存管理**: 处理大图片时注意内存使用
4. **格式支持**: 支持 JPEG、PNG、WebP、GIF、TIFF、AVIF 等格式
