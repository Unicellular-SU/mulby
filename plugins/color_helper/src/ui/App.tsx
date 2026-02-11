import { useEffect, useState, useRef } from 'react'
import { useMulby } from './hooks/useMulby'
import './styles.css'

// 颜色类型定义
interface Color {
  id: string
  name: string
  hex: string
  rgb: string
  hsl: string
  category: string
  isFavorite?: boolean
}

// 渐变类型定义
interface Gradient {
  id: string
  name: string
  colors: string[]
  direction: string
  css: string
  isFavorite?: boolean
}

// 传统色类型定义
interface TraditionalColor {
  id: string
  name: string
  chineseName: string
  hex: string
  pinyin: string
  dynasty?: string
  category: string
}

// UI色卡类型定义
interface UIColor {
  id: string
  name: string
  hex: string
  usage: string
  category: string
}

// 图片色卡类型定义
interface ImageColor {
  id: string
  hex: string
  percentage: number
  rgb: string
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
  attachments?: any[]
}

// 主应用组件
export default function App() {
  const [activeTab, setActiveTab] = useState<'color' | 'image' | 'ui' | 'traditional' | 'gradient' | 'favorites'>('color')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [colorInput, setColorInput] = useState('')
  const [currentColor, setCurrentColor] = useState<Color | null>(null)
  const [favorites, setFavorites] = useState<Color[]>([])
  const [gradientFavorites, setGradientFavorites] = useState<Gradient[]>([])
  const [imageColors, setImageColors] = useState<ImageColor[]>([])
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isProcessingImage, setIsProcessingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { clipboard, notification } = useMulby('color_helper')

  // 传统色数据
  const traditionalColors: TraditionalColor[] = [
    { id: '1', name: '朱红', chineseName: '朱红', hex: '#ED5121', pinyin: 'zhū hóng', dynasty: '明', category: '红色系' },
    { id: '2', name: '胭脂', chineseName: '胭脂', hex: '#9D2933', pinyin: 'yān zhī', dynasty: '唐', category: '红色系' },
    { id: '3', name: '石青', chineseName: '石青', hex: '#1685A9', pinyin: 'shí qīng', dynasty: '宋', category: '青色系' },
    { id: '4', name: '黛蓝', chineseName: '黛蓝', hex: '#425066', pinyin: 'dài lán', dynasty: '清', category: '蓝色系' },
    { id: '5', name: '鹅黄', chineseName: '鹅黄', hex: '#FFF143', pinyin: 'é huáng', dynasty: '宋', category: '黄色系' },
    { id: '6', name: '竹青', chineseName: '竹青', hex: '#789262', pinyin: 'zhú qīng', dynasty: '明', category: '绿色系' },
    { id: '7', name: '月白', chineseName: '月白', hex: '#D6ECF0', pinyin: 'yuè bái', dynasty: '宋', category: '白色系' },
    { id: '8', name: '玄色', chineseName: '玄色', hex: '#622A1D', pinyin: 'xuán sè', dynasty: '周', category: '黑色系' },
  ]

  // UI色卡数据
  const uiColors: UIColor[] = [
    { id: '1', name: 'Primary', hex: '#007AFF', usage: '主要按钮、重要操作', category: '主色' },
    { id: '2', name: 'Secondary', hex: '#5856D6', usage: '次要按钮、次要操作', category: '辅色' },
    { id: '3', name: 'Success', hex: '#34C759', usage: '成功状态、完成提示', category: '状态色' },
    { id: '4', name: 'Warning', hex: '#FF9500', usage: '警告提示、注意信息', category: '状态色' },
    { id: '5', name: 'Error', hex: '#FF3B30', usage: '错误提示、危险操作', category: '状态色' },
    { id: '6', name: 'Background', hex: '#F2F2F7', usage: '背景色、卡片背景', category: '背景色' },
    { id: '7', name: 'Text Primary', hex: '#000000', usage: '主要文字、标题', category: '文字色' },
    { id: '8', name: 'Text Secondary', hex: '#8E8E93', usage: '次要文字、描述', category: '文字色' },
  ]

  // 渐变色数据
  const gradients: Gradient[] = [
    { id: '1', name: '日落', colors: ['#FF6B6B', '#FFE66D'], direction: 'to right', css: 'linear-gradient(to right, #FF6B6B, #FFE66D)', isFavorite: false },
    { id: '2', name: '海洋', colors: ['#4A90E2', '#50E3C2'], direction: 'to right', css: 'linear-gradient(to right, #4A90E2, #50E3C2)', isFavorite: false },
    { id: '3', name: '森林', colors: ['#56CCF2', '#2F80ED'], direction: 'to right', css: 'linear-gradient(to right, #56CCF2, #2F80ED)', isFavorite: false },
    { id: '4', name: '霓虹', colors: ['#FF0080', '#FF8C00'], direction: 'to right', css: 'linear-gradient(to right, #FF0080, #FF8C00)', isFavorite: false },
    { id: '5', name: '柔和', colors: ['#FAD0C4', '#FFD1FF'], direction: 'to right', css: 'linear-gradient(to right, #FAD0C4, #FFD1FF)', isFavorite: false },
    { id: '6', name: '金属', colors: ['#B993D6', '#8CA6DB'], direction: 'to right', css: 'linear-gradient(to right, #B993D6, #8CA6DB)', isFavorite: false },
  ]

  // 颜色解析函数
  const parseColor = (input: string): Color | null => {
    const trimmed = input.trim()
    
    // HEX格式
    if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(trimmed)) {
      const hex = trimmed.length === 4 ? 
        `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}` : 
        trimmed
      
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      
      // RGB转HSL
      const rNorm = r / 255
      const gNorm = g / 255
      const bNorm = b / 255
      
      const max = Math.max(rNorm, gNorm, bNorm)
      const min = Math.min(rNorm, gNorm, bNorm)
      let h = 0, s = 0, l = (max + min) / 2
      
      if (max !== min) {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        
        switch (max) {
          case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break
          case gNorm: h = (bNorm - rNorm) / d + 2; break
          case bNorm: h = (rNorm - gNorm) / d + 4; break
        }
        h /= 6
      }
      
      h = Math.round(h * 360)
      s = Math.round(s * 100)
      l = Math.round(l * 100)
      
      return {
        id: Date.now().toString(),
        name: `颜色 ${hex}`,
        hex: hex.toUpperCase(),
        rgb: `rgb(${r}, ${g}, ${b})`,
        hsl: `hsl(${h}, ${s}%, ${l}%)`,
        category: '自定义'
      }
    }
    
    // RGB格式
    const rgbMatch = trimmed.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i)
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1])
      const g = parseInt(rgbMatch[2])
      const b = parseInt(rgbMatch[3])
      
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      
      return {
        id: Date.now().toString(),
        name: `颜色 ${hex}`,
        hex: hex.toUpperCase(),
        rgb: `rgb(${r}, ${g}, ${b})`,
        hsl: '', // 简化处理
        category: '自定义'
      }
    }
    
    return null
  }

  // 处理颜色输入
  const handleColorInput = () => {
    if (!colorInput.trim()) {
      notification.show('请输入颜色值')
      return
    }
    
    const color = parseColor(colorInput)
    if (color) {
      setCurrentColor(color)
      notification.show('颜色解析成功')
    } else {
      notification.show('无法识别的颜色格式')
    }
  }

  // 复制颜色值
  const copyColorValue = (value: string, format: string) => {
    clipboard.writeText(value)
    notification.show(`${format}已复制`)
  }

  // 添加到收藏
  const addToFavorites = (color: Color) => {
    if (!favorites.some(fav => fav.hex === color.hex)) {
      const newFavorites = [...favorites, { ...color, isFavorite: true }]
      setFavorites(newFavorites)
      notification.show('已添加到收藏')
    } else {
      notification.show('颜色已在收藏中')
    }
  }

  // 从收藏移除
  const removeFromFavorites = (colorId: string) => {
    setFavorites(favorites.filter(fav => fav.id !== colorId))
    notification.show('已从收藏移除')
  }

  // 添加渐变色到收藏
  const addGradientToFavorites = (gradient: Gradient) => {
    if (!gradientFavorites.some(fav => fav.id === gradient.id)) {
      const newFav = { ...gradient, isFavorite: true }
      setGradientFavorites([...gradientFavorites, newFav])
      notification.show('渐变色已收藏')
    }
  }

  // 从渐变色收藏移除
  const removeGradientFromFavorites = (gradientId: string) => {
    setGradientFavorites(gradientFavorites.filter(fav => fav.id !== gradientId))
    notification.show('已从收藏移除')
  }

  // 复制渐变色
  const copyGradient = (gradient: Gradient) => {
    clipboard.writeText(gradient.css)
    notification.show('渐变CSS已复制')
  }

  // 处理图片上传
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    // 检查是否为图片
    if (!file.type.startsWith('image/')) {
      notification.show('请选择图片文件')
      return
    }
    
    setIsProcessingImage(true)
    
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setImagePreview(dataUrl)
      // 清除之前的颜色数据
      setImageColors([])
      // 提取图片主色
      extractImageColors(dataUrl)
      setIsProcessingImage(false)
    }
    
    reader.onerror = () => {
      notification.show('图片读取失败')
      setIsProcessingImage(false)
    }
    
    reader.readAsDataURL(file)
  }

  // 提取图片颜色（改进版）
  const extractImageColors = (imageUrl: string) => {
    // 创建图片元素
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      // 创建canvas来提取颜色
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        notification.show('无法创建画布上下文')
        return
      }
      
      // 设置canvas尺寸
      canvas.width = img.width
      canvas.height = img.height
      
      // 绘制图片到canvas
      ctx.drawImage(img, 0, 0)
      
      try {
        // 获取图片数据
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = imageData.data
        
        // 简化版颜色提取：采样像素
        const colorMap = new Map<string, number>()
        const sampleStep = Math.floor(data.length / 4 / 1000) // 采样1000个像素
        
        for (let i = 0; i < data.length; i += 4 * sampleStep) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          
          // 转换为HEX
          const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
          
          // 计数
          colorMap.set(hex, (colorMap.get(hex) || 0) + 1)
        }
        
        // 转换为数组并排序
        const colorsArray = Array.from(colorMap.entries())
          .map(([hex, count]) => ({
            hex,
            count,
            rgb: `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
          }))
          .sort((a, b) => b.count - a.count) // 按出现次数排序
          .slice(0, 5) // 取前5种颜色
        
        // 计算百分比
        const totalCount = colorsArray.reduce((sum, color) => sum + color.count, 0)
        
        const extractedColors: ImageColor[] = colorsArray.map((color, index) => ({
          id: (index + 1).toString(),
          hex: color.hex.toUpperCase(),
          percentage: Math.round((color.count / totalCount) * 100),
          rgb: color.rgb
        }))
        
        setImageColors(extractedColors)
        notification.show('颜色提取完成')
        
      } catch (error) {
        console.error('颜色提取错误:', error)
        // 如果提取失败，使用模拟数据
        useMockImageColors()
      }
    }
    
    img.onerror = () => {
      notification.show('图片加载失败')
      useMockImageColors()
    }
    
    img.src = imageUrl
  }

  // 使用模拟图片颜色数据
  const useMockImageColors = () => {
    const mockColors: ImageColor[] = [
      { id: '1', hex: '#FF6B6B', percentage: 30, rgb: 'rgb(255, 107, 107)' },
      { id: '2', hex: '#4A90E2', percentage: 25, rgb: 'rgb(74, 144, 226)' },
      { id: '3', hex: '#50E3C2', percentage: 20, rgb: 'rgb(80, 227, 194)' },
      { id: '4', hex: '#F5F5F5', percentage: 15, rgb: 'rgb(245, 245, 245)' },
      { id: '5', hex: '#333333', percentage: 10, rgb: 'rgb(51, 51, 51)' },
    ]
    setImageColors(mockColors)
    notification.show('使用模拟颜色数据')
  }

  // 复制图片颜色
  const copyImageColor = (color: ImageColor) => {
    clipboard.writeText(color.hex)
    notification.show('颜色已复制')
  }

  // 复制传统色
  const copyTraditionalColor = (color: TraditionalColor) => {
    clipboard.writeText(color.hex)
    notification.show(`${color.chineseName} 颜色已复制`)
  }

  // 复制UI色
  const copyUIColor = (color: UIColor) => {
    clipboard.writeText(color.hex)
    notification.show(`${color.name} 颜色已复制`)
  }

  // 重置图片上传
  const resetImageUpload = () => {
    setImagePreview(null)
    setImageColors([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // 当切换到图片标签页时，如果没有图片，显示上传提示
  useEffect(() => {
    // 如果切换到图片标签页且没有图片，确保状态正确
    if (activeTab === 'image' && !imagePreview) {
      setImageColors([])
    }
  }, [activeTab, imagePreview])

  useEffect(() => {
    // 获取初始主题
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    // 监听主题变化
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据
    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      if (data.input) {
        setColorInput(data.input)
        const color = parseColor(data.input)
        if (color) {
          setCurrentColor(color)
        }
      }
      
      // 如果有图片附件，自动处理
      if (data.attachments && data.attachments.length > 0) {
        const imageAttachment = data.attachments.find(att => 
          att.kind === 'image' || 
          att.mime?.startsWith('image/')
        )
        
        if (imageAttachment && imageAttachment.dataUrl) {
          setActiveTab('image')
          setImagePreview(imageAttachment.dataUrl)
          extractImageColors(imageAttachment.dataUrl)
        }
      }
    })
  }, [])

  return (
    <div className="app">
      <div className="titlebar">🎨 颜色助手</div>
      
      <div className="container">
        {/* 标签页导航 */}
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'color' ? 'active' : ''}`}
            onClick={() => setActiveTab('color')}
          >
            颜色解析
          </button>
          <button 
            className={`tab ${activeTab === 'image' ? 'active' : ''}`}
            onClick={() => setActiveTab('image')}
          >
            图片色卡
          </button>
          <button 
            className={`tab ${activeTab === 'ui' ? 'active' : ''}`}
            onClick={() => setActiveTab('ui')}
          >
            UI色卡
          </button>
          <button 
            className={`tab ${activeTab === 'traditional' ? 'active' : ''}`}
            onClick={() => setActiveTab('traditional')}
          >
            传统色
          </button>
          <button 
            className={`tab ${activeTab === 'gradient' ? 'active' : ''}`}
            onClick={() => setActiveTab('gradient')}
          >
            渐变色
          </button>
          <button 
            className={`tab ${activeTab === 'favorites' ? 'active' : ''}`}
            onClick={() => setActiveTab('favorites')}
          >
            收藏 ({favorites.length + gradientFavorites.length})
          </button>
        </div>

        {/* 内容区域 */}
        <div className="content">
          {/* 颜色解析标签页 */}
          {activeTab === 'color' && (
            <div className="color-tab">
              <div className="field">
                <label>输入颜色值 (HEX/RGB)</label>
                <div className="input-group">
                  <input
                    type="text"
                    value={colorInput}
                    onChange={(e) => setColorInput(e.target.value)}
                    placeholder="例如: #FF6B6B 或 rgb(255, 107, 107)"
                    className="color-input"
                  />
                  <button className="btn-primary" onClick={handleColorInput}>
                    解析
                  </button>
                </div>
              </div>

              {currentColor && (
                <div className="color-display">
                  <div className="color-preview" style={{ backgroundColor: currentColor.hex }} />
                  <div className="color-info">
                    <div className="color-name">{currentColor.name}</div>
                    <div className="color-values">
                      <div className="color-value">
                        <span>HEX</span>
                        <div className="value-row">
                          <code>{currentColor.hex}</code>
                          <button 
                            className="btn-copy"
                            onClick={() => copyColorValue(currentColor.hex, 'HEX')}
                          >
                            复制
                          </button>
                        </div>
                      </div>
                      <div className="color-value">
                        <span>RGB</span>
                        <div className="value-row">
                          <code>{currentColor.rgb}</code>
                          <button 
                            className="btn-copy"
                            onClick={() => copyColorValue(currentColor.rgb, 'RGB')}
                          >
                            复制
                          </button>
                        </div>
                      </div>
                      <div className="color-value">
                        <span>HSL</span>
                        <div className="value-row">
                          <code>{currentColor.hsl}</code>
                          <button 
                            className="btn-copy"
                            onClick={() => copyColorValue(currentColor.hsl, 'HSL')}
                          >
                            复制
                          </button>
                        </div>
                      </div>
                    </div>
                    <button 
                      className="btn-favorite"
                      onClick={() => addToFavorites(currentColor)}
                    >
                      ❤️ 添加到收藏
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 图片色卡标签页 */}
          {activeTab === 'image' && (
            <div className="image-tab">
              <div className="field">
                <label>上传图片提取颜色</label>
                <div className="upload-area">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="file-input"
                    id="image-upload"
                  />
                  <label htmlFor="image-upload" className="upload-label">
                    <div className="upload-icon">📁</div>
                    <div className="upload-text">点击选择图片或拖拽到此处</div>
                    <div className="upload-hint">支持 JPG、PNG、GIF、WebP、BMP 格式</div>
                  </label>
                </div>
                
                {imagePreview && (
                  <div className="image-controls">
                    <button 
                      className="btn-secondary"
                      onClick={resetImageUpload}
                    >
                      重新上传
                    </button>
                  </div>
                )}
              </div>

              {isProcessingImage && (
                <div className="processing-indicator">
                  <div className="spinner"></div>
                  <div className="processing-text">正在提取颜色...</div>
                </div>
              )}

              {imagePreview && !isProcessingImage && (
                <div className="image-preview-container">
                  <div className="image-preview">
                    <img src={imagePreview} alt="预览" />
                  </div>
                  
                  {imageColors.length > 0 ? (
                    <div className="extracted-colors">
                      <div className="section-header">
                        <h3>提取的颜色</h3>
                        <div className="color-count">{imageColors.length} 种颜色</div>
                      </div>
                      <div className="color-grid">
                        {imageColors.map((color) => (
                          <div key={color.id} className="extracted-color">
                            <div 
                              className="color-swatch" 
                              style={{ backgroundColor: color.hex }}
                            />
                            <div className="color-info">
                              <div className="color-hex">{color.hex}</div>
                              <div className="color-percentage">{color.percentage}%</div>
                              <button 
                                className="btn-copy-small"
                                onClick={() => copyImageColor(color)}
                              >
                                复制
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="no-colors-message">
                      <div className="no-colors-icon">🎨</div>
                      <div className="no-colors-text">正在分析图片颜色...</div>
                      <div className="no-colors-hint">请稍等片刻</div>
                    </div>
                  )}
                </div>
              )}

              {!imagePreview && !isProcessingImage && (
                <div className="upload-instructions">
                  <div className="instruction-card">
                    <div className="instruction-icon">📸</div>
                    <div className="instruction-title">如何使用图片色卡功能</div>
                    <div className="instruction-steps">
                      <div className="step">1. 点击上方区域选择图片</div>
                      <div className="step">2. 或拖拽图片文件到该区域</div>
                      <div className="step">3. 等待系统分析图片颜色</div>
                      <div className="step">4. 查看提取的颜色并复制使用</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* UI色卡标签页 */}
          {activeTab === 'ui' && (
            <div className="ui-tab">
              <div className="ui-colors-grid">
                {uiColors.map((color) => (
                  <div key={color.id} className="ui-color-card">
                    <div 
                      className="ui-color-swatch" 
                      style={{ backgroundColor: color.hex }}
                    />
                    <div className="ui-color-info">
                      <div className="ui-color-name">{color.name}</div>
                      <div className="ui-color-hex">{color.hex}</div>
                      <div className="ui-color-usage">{color.usage}</div>
                      <div className="ui-color-category">{color.category}</div>
                      <button 
                        className="btn-copy-small"
                        onClick={() => copyUIColor(color)}
                      >
                        复制颜色
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 传统色标签页 */}
          {activeTab === 'traditional' && (
            <div className="traditional-tab">
              <div className="traditional-colors-grid">
                {traditionalColors.map((color) => (
                  <div key={color.id} className="traditional-color-card">
                    <div 
                      className="traditional-color-swatch" 
                      style={{ backgroundColor: color.hex }}
                    />
                    <div className="traditional-color-info">
                      <div className="traditional-color-name">{color.chineseName}</div>
                      <div className="traditional-color-pinyin">{color.pinyin}</div>
                      <div className="traditional-color-hex">{color.hex}</div>
                      {color.dynasty && (
                        <div className="traditional-color-dynasty">朝代: {color.dynasty}</div>
                      )}
                      <div className="traditional-color-category">分类: {color.category}</div>
                      <button 
                        className="btn-copy-small"
                        onClick={() => copyTraditionalColor(color)}
                      >
                        复制颜色
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 渐变色标签页 */}
          {activeTab === 'gradient' && (
            <div className="gradient-tab">
              <div className="gradients-grid">
                {gradients.map((gradient) => (
                  <div key={gradient.id} className="gradient-card">
                    <div 
                      className="gradient-preview" 
                      style={{ background: gradient.css }}
                    />
                    <div className="gradient-info">
                      <div className="gradient-name">{gradient.name}</div>
                      <div className="gradient-colors">
                        {gradient.colors.map((color, index) => (
                          <span key={index} className="gradient-color-tag">
                            {color}
                          </span>
                        ))}
                      </div>
                      <div className="gradient-actions">
                        <button 
                          className="btn-copy-small"
                          onClick={() => copyGradient(gradient)}
                        >
                          复制CSS
                        </button>
                        <button 
                          className={`btn-favorite-small ${gradient.isFavorite ? 'favorited' : ''}`}
                          onClick={() => gradient.isFavorite ? 
                            removeGradientFromFavorites(gradient.id) : 
                            addGradientToFavorites(gradient)}
                        >
                          {gradient.isFavorite ? '❤️ 已收藏' : '🤍 收藏'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 收藏标签页 */}
          {activeTab === 'favorites' && (
            <div className="favorites-tab">
              {/* 收藏的颜色 */}
              {favorites.length > 0 && (
                <div className="favorites-section">
                  <h3>收藏的颜色 ({favorites.length})</h3>
                  <div className="favorites-colors">
                    {favorites.map((color) => (
                      <div key={color.id} className="favorite-color">
                        <div 
                          className="color-swatch" 
                          style={{ backgroundColor: color.hex }}
                        />
                        <div className="color-details">
                          <div className="color-hex">{color.hex}</div>
                          <div className="color-rgb">{color.rgb}</div>
                        </div>
                        <div className="color-actions">
                          <button 
                            className="btn-copy-small"
                            onClick={() => copyColorValue(color.hex, 'HEX')}
                          >
                            复制
                          </button>
                          <button 
                            className="btn-remove"
                            onClick={() => removeFromFavorites(color.id)}
                          >
                            移除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 收藏的渐变色 */}
              {gradientFavorites.length > 0 && (
                <div className="favorites-section">
                  <h3>收藏的渐变色 ({gradientFavorites.length})</h3>
                  <div className="favorites-gradients">
                    {gradientFavorites.map((gradient) => (
                      <div key={gradient.id} className="favorite-gradient">
                        <div 
                          className="gradient-preview" 
                          style={{ background: gradient.css }}
                        />
                        <div className="gradient-details">
                          <div className="gradient-name">{gradient.name}</div>
                          <div className="gradient-css">{gradient.css}</div>
                        </div>
                        <div className="gradient-actions">
                          <button 
                            className="btn-copy-small"
                            onClick={() => copyGradient(gradient)}
                          >
                            复制
                          </button>
                          <button 
                            className="btn-remove"
                            onClick={() => removeGradientFromFavorites(gradient.id)}
                          >
                            移除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {favorites.length === 0 && gradientFavorites.length === 0 && (
                <div className="empty-favorites">
                  <div className="empty-icon">📋</div>
                  <div className="empty-text">暂无收藏内容</div>
                  <div className="empty-hint">在颜色解析或渐变色页面添加收藏</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}