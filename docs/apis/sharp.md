# Sharp 图像处理 API

Sharp API 提供高性能的图像处理功能，包括缩放、裁剪、旋转、格式转换等。基于 [sharp](https://sharp.pixelplumbing.com/) 库实现。

## 基本用法

```javascript
// 调整尺寸
const buffer = await intools.sharp('/path/to/image.jpg')
  .resize(200, 200)
  .toBuffer()

// 链式操作
const buffer = await intools.sharp('/path/to/image.jpg')
  .resize(300, 300, { fit: 'cover' })
  .grayscale()
  .blur(2)
  .toBuffer()

// 格式转换
await intools.sharp('/path/to/input.png')
  .jpeg({ quality: 80 })
  .toFile('/path/to/output.jpg')
```

## sharp(input?, options?)

创建 Sharp 实例。

**参数**:
- `input` - 图片输入，支持以下类型：
  - `string` - 文件路径
  - `Buffer` / `ArrayBuffer` / `Uint8Array` - 二进制数据
  - `{ create: { width, height, channels, background } }` - 创建空白图像
  - `{ text: { text, width?, height? } }` - 创建文本图像
- `options` - Sharp 选项（可选）

## 尺寸调整方法

### resize(width?, height?, options?)

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

裁剪图像区域。

```javascript
.extract({ left: 10, top: 10, width: 100, height: 100 })
```

### trim(options?)

自动裁剪边缘空白。

```javascript
.trim({ threshold: 10 })
```

## 变换方法

### rotate(angle?, options?)

旋转图像。

```javascript
.rotate(90)  // 旋转 90 度
.rotate()    // 根据 EXIF 自动旋转
```

### flip() / flop()

垂直翻转 / 水平翻转。

```javascript
.flip()  // 垂直翻转
.flop()  // 水平翻转
```

## 图像处理方法

### blur(sigma?)

模糊处理。

```javascript
.blur(5)  // sigma 0.3-1000
```

### sharpen(options?)

锐化处理。

```javascript
.sharpen()
.sharpen({ sigma: 2 })
```

### grayscale() / greyscale()

转换为灰度图。

```javascript
.grayscale()
```

### negate(options?)

反相处理。

```javascript
.negate()
```

### gamma(gamma?)

伽马校正。

```javascript
.gamma(2.2)
```

### threshold(threshold?, options?)

二值化处理。

```javascript
.threshold(128)
```

### modulate(options?)

调整亮度、饱和度、色相。

```javascript
.modulate({
  brightness: 1.2,  // 亮度
  saturation: 0.8,  // 饱和度
  hue: 180          // 色相偏移
})
```

### tint(color)

着色处理。

```javascript
.tint({ r: 255, g: 0, b: 0 })
.tint('#ff0000')
```

## 合成方法

### composite(images)

图像合成。

```javascript
.composite([{
  input: '/path/to/overlay.png',
  gravity: 'southeast',  // 位置
  blend: 'over'          // 混合模式
}])
```

## 输出格式方法

### png(options?) / jpeg(options?) / webp(options?) / gif(options?) / tiff(options?) / avif(options?)

设置输出格式。

```javascript
.png({ compressionLevel: 9 })
.jpeg({ quality: 80, progressive: true })
.webp({ quality: 75, lossless: false })
```

## 终结方法

### toBuffer(options?)

输出为 Buffer。

```javascript
const buffer = await sharp('/path/to/image.jpg')
  .resize(200, 200)
  .toBuffer()
```

### toFile(path)

输出到文件。

```javascript
const info = await sharp('/path/to/input.jpg')
  .resize(200, 200)
  .toFile('/path/to/output.jpg')

// info: { format, width, height, channels, size }
```

### metadata()

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

获取图像统计信息。

```javascript
const stats = await sharp('/path/to/image.jpg').stats()
// { channels, isOpaque, entropy, sharpness, dominant }
```

## 创建空白图像

```javascript
const buffer = await intools.sharp({
  create: {
    width: 200,
    height: 200,
    channels: 4,
    background: { r: 59, g: 130, b: 246, alpha: 1 }
  }
}).png().toBuffer()
```

## 获取 Sharp 版本信息

```javascript
const version = await intools.getSharpVersion()
// { sharp: { vips: '...', sharp: '...' }, format: { ... } }
```

## 完整示例

### 图片处理插件

```javascript
// 批量处理图片
async function processImages(paths) {
  for (const path of paths) {
    // 获取元数据
    const meta = await intools.sharp(path).metadata()
    console.log(`处理: ${path} (${meta.width}x${meta.height})`)
    
    // 生成缩略图
    await intools.sharp(path)
      .resize(150, 150, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(path.replace(/\.\w+$/, '_thumb.jpg'))
  }
}

// 添加水印
async function addWatermark(imagePath, watermarkPath, outputPath) {
  await intools.sharp(imagePath)
    .composite([{
      input: watermarkPath,
      gravity: 'southeast'
    }])
    .toFile(outputPath)
}
```

## 注意事项

1. **链式调用**: 所有方法都返回构建器对象，支持链式调用
2. **异步操作**: 终结方法（`toBuffer`, `toFile`, `metadata`, `stats`）返回 Promise
3. **内存管理**: 处理大图片时注意内存使用
4. **格式支持**: 支持 JPEG、PNG、WebP、GIF、TIFF、AVIF 等格式
