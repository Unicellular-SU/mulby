import { useEffect, useState, useRef } from 'react'
import { useIntools } from './hooks/useIntools'
import './App.css'

// 图片类型定义
interface ImageData {
  id: string
  name: string
  size: number
  dataUrl: string
  width: number
  height: number
  cropTop: number // 裁切顶部百分比 (0-100)
  cropBottom: number // 裁切底部百分比 (0-100)
  visibleHeight: number // 实际显示高度
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
  attachments?: Array<{
    id: string
    name: string
    size: number
    kind: 'file' | 'image'
    mime?: string
    ext?: string
    path?: string
    dataUrl?: string
  }>
}

export default function App() {
  const [images, setImages] = useState<ImageData[]>([])
  const [outputImage, setOutputImage] = useState<string>('')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [isProcessing, setIsProcessing] = useState(false)
  const [outputWidth, setOutputWidth] = useState<number>(800)
  const [spacing, setSpacing] = useState<number>(0)
  const [backgroundColor, setBackgroundColor] = useState<string>('#ffffff')
  const { clipboard, notification } = useIntools('image_stitching')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // 获取初始主题
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    // 监听主题变化
    window.intools?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据
    window.intools?.onPluginInit?.((data: PluginInitData) => {
      if (data.attachments) {
        const imageAttachments = data.attachments.filter(
          item => item.kind === 'image' && item.dataUrl
        )

        if (imageAttachments.length > 0) {
          loadImages(imageAttachments)
        }
      }
    })
  }, [])

  const loadImages = async (attachments: PluginInitData['attachments']) => {
    const loadedImages: ImageData[] = []

    for (const attachment of attachments || []) {
      if (attachment.dataUrl) {
        try {
          const img = new Image()
          await new Promise((resolve, reject) => {
            img.onload = resolve
            img.onerror = reject
            img.src = attachment.dataUrl!
          })

          loadedImages.push({
            id: attachment.id || Date.now().toString(),
            name: attachment.name,
            size: attachment.size,
            dataUrl: attachment.dataUrl,
            width: img.width,
            height: img.height,
            cropTop: 0,
            cropBottom: 0,
            visibleHeight: img.height
          })
        } catch (error) {
          console.error('加载图片失败:', error)
        }
      }
    }

    setImages(loadedImages)
    if (loadedImages.length > 0) {
      // 设置默认输出宽度为第一张图片的宽度
      setOutputWidth(loadedImages[0].width)
    }
  }

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return

    const newImages: ImageData[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        try {
          const dataUrl = await readFileAsDataURL(file)
          const img = new Image()
          await new Promise((resolve, reject) => {
            img.onload = resolve
            img.onerror = reject
            img.src = dataUrl
          })

          newImages.push({
            id: Date.now() + i.toString(),
            name: file.name,
            size: file.size,
            dataUrl,
            width: img.width,
            height: img.height,
            cropTop: 0,
            cropBottom: 0,
            visibleHeight: img.height
          })
        } catch (error) {
          console.error('读取图片失败:', error)
        }
      }
    }

    setImages(prev => [...prev, ...newImages])
    if (newImages.length > 0 && images.length === 0) {
      setOutputWidth(newImages[0].width)
    }

    event.target.value = ''
  }

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const updateCrop = (id: string, cropTop: number, cropBottom: number) => {
    setImages(prev => prev.map(img => {
      if (img.id === id) {
        const topPixels = (img.height * cropTop) / 100
        const bottomPixels = (img.height * cropBottom) / 100
        const visibleHeight = img.height - topPixels - bottomPixels

        return {
          ...img,
          cropTop,
          cropBottom,
          visibleHeight: Math.max(0, visibleHeight)
        }
      }
      return img
    }))
  }

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }

  const moveImage = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === images.length - 1)
    ) {
      return
    }

    const newImages = [...images]
    const newIndex = direction === 'up' ? index - 1 : index + 1
      ;[newImages[index], newImages[newIndex]] = [newImages[newIndex], newImages[index]]
    setImages(newImages)
  }

  const stitchImages = async () => {
    if (images.length === 0) {
      notification.show('请先添加图片')
      return
    }

    setIsProcessing(true)

    try {
      // 计算总高度
      const totalHeight = images.reduce((sum, img) => {
        const scale = outputWidth / img.width
        return sum + (img.visibleHeight * scale) + spacing
      }, -spacing) // 减去最后一个间距

      // 创建canvas
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = outputWidth
      canvas.height = totalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // 填充背景色
      ctx.fillStyle = backgroundColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // 绘制图片
      let currentY = 0

      for (const imgData of images) {
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
          img.src = imgData.dataUrl
        })

        // 计算缩放比例
        const scale = outputWidth / imgData.width
        const scaledHeight = imgData.visibleHeight * scale

        // 计算裁切区域
        const cropTopPixels = (imgData.height * imgData.cropTop) / 100
        const cropBottomPixels = (imgData.height * imgData.cropBottom) / 100
        const sourceHeight = imgData.height - cropTopPixels - cropBottomPixels

        // 绘制图片
        ctx.drawImage(
          img,
          0, cropTopPixels, // 源图像裁切起点
          imgData.width, sourceHeight, // 源图像裁切尺寸
          0, currentY, // 目标位置
          outputWidth, scaledHeight // 目标尺寸
        )

        currentY += scaledHeight + spacing
      }

      // 获取结果图片
      const resultDataUrl = canvas.toDataURL('image/png')
      setOutputImage(resultDataUrl)

      notification.show('图片拼接完成！')
    } catch (error) {
      console.error('拼接图片失败:', error)
      notification.show('拼接失败，请重试')
    } finally {
      setIsProcessing(false)
    }
  }

  const copyToClipboard = async () => {
    if (!outputImage) {
      notification.show('请先生成拼接图片')
      return
    }

    try {
      // 将DataURL转换为Blob
      const response = await fetch(outputImage)
      const blob = await response.blob()

      // 复制到剪贴板
      const clipboardItem = new ClipboardItem({ 'image/png': blob })
      await navigator.clipboard.write([clipboardItem])

      notification.show('已复制到剪贴板')
    } catch (error) {
      console.error('复制失败:', error)
      notification.show('复制失败，请重试')
    }
  }

  const downloadImage = () => {
    if (!outputImage) {
      notification.show('请先生成拼接图片')
      return
    }

    const link = document.createElement('a')
    link.href = outputImage
    link.download = `stitched_image_${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    notification.show('图片已下载')
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className="app">
      <div className="container">
        <h1>长图拼接</h1>
        <p className="subtitle">将多张图片任意纵向裁切后拼接成一张长图</p>

        {/* 图片上传区域 */}
        <div className="upload-section">
          <label className="upload-btn">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <span className="upload-icon">+</span>
            <span>添加图片</span>
          </label>
          <span className="upload-hint">
            支持拖放或点击上传多张图片<br />
            支持格式：PNG、JPG、JPEG、GIF、WebP、BMP
          </span>
        </div>

        {/* 图片列表 */}
        {images.length > 0 && (
          <div className="images-section">
            <h2>图片列表 ({images.length})</h2>
            <div className="images-list">
              {images.map((img, index) => (
                <div key={img.id} className="image-item">
                  <div className="image-header">
                    <div className="image-info">
                      <span className="image-name">{img.name}</span>
                      <span className="image-dimensions">
                        {img.width} × {img.height} ({formatSize(img.size)})
                      </span>
                    </div>
                    <div className="image-actions">
                      <button
                        className="btn-icon"
                        onClick={() => moveImage(index, 'up')}
                        disabled={index === 0}
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => moveImage(index, 'down')}
                        disabled={index === images.length - 1}
                        title="下移"
                      >
                        ↓
                      </button>
                      <button
                        className="btn-icon btn-danger"
                        onClick={() => removeImage(img.id)}
                        title="删除"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div className="image-preview-container">
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="image-preview"
                    />
                    <div className="crop-overlay">
                      <div
                        className="crop-top"
                        style={{ height: `${img.cropTop}%` }}
                      />
                      <div
                        className="crop-bottom"
                        style={{ height: `${img.cropBottom}%` }}
                      />
                    </div>
                  </div>

                  <div className="crop-controls">
                    <div className="crop-slider">
                      <label>顶部裁切: {img.cropTop}%</label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={img.cropTop}
                        onChange={(e) => updateCrop(img.id, parseInt(e.target.value), img.cropBottom)}
                      />
                    </div>
                    <div className="crop-slider">
                      <label>底部裁切: {img.cropBottom}%</label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={img.cropBottom}
                        onChange={(e) => updateCrop(img.id, img.cropTop, parseInt(e.target.value))}
                      />
                    </div>
                    <div className="crop-info">
                      显示高度: {Math.round(img.visibleHeight)}px
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 拼接设置 */}
        <div className="settings-section">
          <h2>拼接设置</h2>
          <div className="settings-grid">
            <div className="setting-item">
              <label>输出宽度 (px)</label>
              <input
                type="number"
                min="100"
                max="5000"
                value={outputWidth}
                onChange={(e) => setOutputWidth(parseInt(e.target.value) || 800)}
              />
            </div>
            <div className="setting-item">
              <label>图片间距 (px)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={spacing}
                onChange={(e) => setSpacing(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="setting-item">
              <label>背景颜色</label>
              <div className="color-picker">
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                />
                <span>{backgroundColor}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="action-section">
          <button
            className="btn-primary"
            onClick={stitchImages}
            disabled={isProcessing || images.length === 0}
          >
            {isProcessing ? '🔄 处理中...' : '🚀 开始拼接'}
          </button>
        </div>

        {/* 结果展示 */}
        {outputImage && (
          <div className="result-section">
            <h2>拼接结果</h2>
            <div className="result-container">
              <img
                src={outputImage}
                alt="拼接结果"
                className="result-image"
              />
              <div className="result-actions">
                <button
                  className="btn-secondary"
                  onClick={copyToClipboard}
                >
                  📋 复制到剪贴板
                </button>
                <button
                  className="btn-secondary"
                  onClick={downloadImage}
                >
                  ⬇️ 下载图片
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 隐藏的canvas用于图片处理 */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  )
}