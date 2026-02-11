import { useEffect, useState, useCallback } from 'react'
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, parseColor } from './colorUtils'

interface ColorState {
  hex: string
  rgb: { r: number; g: number; b: number }
  hsl: { h: number; s: number; l: number }
}

// 从 URL 获取初始主题
function getInitialTheme(): 'light' | 'dark' {
  const params = new URLSearchParams(window.location.search)
  return (params.get('theme') as 'light' | 'dark') || 'light'
}

export default function App() {
  const [color, setColor] = useState<ColorState>({
    hex: '#3B82F6',
    rgb: { r: 59, g: 130, b: 246 },
    hsl: { h: 217, s: 91, l: 60 }
  })
  const [activeTab, setActiveTab] = useState<'hex' | 'rgb' | 'hsl'>('hex')
  const [copied, setCopied] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme)

  // 应用主题到 document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // 监听主题变化消息
  useEffect(() => {
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
    })
  }, [])

  useEffect(() => {
    window.mulby?.onPluginInit?.((data) => {
      if (data.input) {
        const parsed = parseColor(data.input)
        if (parsed) updateFromRgb(parsed)
      }
    })
  }, [])

  const updateFromRgb = useCallback((rgb: { r: number; g: number; b: number }) => {
    setColor({
      hex: rgbToHex(rgb.r, rgb.g, rgb.b),
      rgb,
      hsl: rgbToHsl(rgb.r, rgb.g, rgb.b)
    })
  }, [])

  const handleHexChange = (hex: string) => {
    const rgb = hexToRgb(hex)
    if (rgb) {
      setColor({ hex, rgb, hsl: rgbToHsl(rgb.r, rgb.g, rgb.b) })
    } else {
      setColor(prev => ({ ...prev, hex }))
    }
  }

  const handleRgbChange = (key: 'r' | 'g' | 'b', value: number) => {
    const rgb = { ...color.rgb, [key]: Math.max(0, Math.min(255, value)) }
    setColor({ hex: rgbToHex(rgb.r, rgb.g, rgb.b), rgb, hsl: rgbToHsl(rgb.r, rgb.g, rgb.b) })
  }

  const handleHslChange = (key: 'h' | 's' | 'l', value: number) => {
    const max = key === 'h' ? 360 : 100
    const hsl = { ...color.hsl, [key]: Math.max(0, Math.min(max, value)) }
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l)
    setColor({ hex: rgbToHex(rgb.r, rgb.g, rgb.b), rgb, hsl })
  }

  const copyToClipboard = async (text: string, label: string) => {
    await window.mulby?.clipboard?.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
    window.mulby?.notification?.show(`${label} 已复制`)
  }

  const formatRgb = () => `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`
  const formatHsl = () => `hsl(${color.hsl.h}, ${color.hsl.s}%, ${color.hsl.l}%)`

  return (
    <div className="app">
      <div className="container">
        <div className="preview-section">
          <div className="color-preview" style={{ backgroundColor: color.hex }}>
            <span className="color-text">{color.hex}</span>
          </div>
          <input
            type="color"
            value={color.hex}
            onChange={(e) => handleHexChange(e.target.value)}
            className="color-picker"
            title="选择颜色"
          />
        </div>

        <div className="tabs">
          {(['hex', 'rgb', 'hsl'] as const).map(tab => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="input-section">
          {activeTab === 'hex' && (
            <div className="input-group">
              <label>HEX</label>
              <div className="input-row">
                <input
                  type="text"
                  value={color.hex}
                  onChange={(e) => handleHexChange(e.target.value)}
                  placeholder="#000000"
                />
                <button
                  className={`copy-btn ${copied === 'HEX' ? 'copied' : ''}`}
                  onClick={() => copyToClipboard(color.hex, 'HEX')}
                >
                  {copied === 'HEX' ? '✓' : '复制'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'rgb' && (
            <div className="input-group">
              <label>RGB</label>
              <div className="rgb-inputs">
                {(['r', 'g', 'b'] as const).map(key => (
                  <div key={key} className="rgb-input">
                    <span>{key.toUpperCase()}</span>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={color.rgb[key]}
                      onChange={(e) => handleRgbChange(key, parseInt(e.target.value) || 0)}
                    />
                  </div>
                ))}
              </div>
              <div className="input-row">
                <input type="text" value={formatRgb()} readOnly />
                <button
                  className={`copy-btn ${copied === 'RGB' ? 'copied' : ''}`}
                  onClick={() => copyToClipboard(formatRgb(), 'RGB')}
                >
                  {copied === 'RGB' ? '✓' : '复制'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'hsl' && (
            <div className="input-group">
              <label>HSL</label>
              <div className="hsl-inputs">
                <div className="hsl-input">
                  <span>H</span>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={color.hsl.h}
                    onChange={(e) => handleHslChange('h', parseInt(e.target.value))}
                    style={{
                      background: `linear-gradient(to right,
                      hsl(0, ${color.hsl.s}%, ${color.hsl.l}%),
                      hsl(60, ${color.hsl.s}%, ${color.hsl.l}%),
                      hsl(120, ${color.hsl.s}%, ${color.hsl.l}%),
                      hsl(180, ${color.hsl.s}%, ${color.hsl.l}%),
                      hsl(240, ${color.hsl.s}%, ${color.hsl.l}%),
                      hsl(300, ${color.hsl.s}%, ${color.hsl.l}%),
                      hsl(360, ${color.hsl.s}%, ${color.hsl.l}%))`
                    }}
                  />
                  <span className="value">{color.hsl.h}°</span>
                </div>
                <div className="hsl-input">
                  <span>S</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={color.hsl.s}
                    onChange={(e) => handleHslChange('s', parseInt(e.target.value))}
                  />
                  <span className="value">{color.hsl.s}%</span>
                </div>
                <div className="hsl-input">
                  <span>L</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={color.hsl.l}
                    onChange={(e) => handleHslChange('l', parseInt(e.target.value))}
                  />
                  <span className="value">{color.hsl.l}%</span>
                </div>
              </div>
              <div className="input-row">
                <input type="text" value={formatHsl()} readOnly />
                <button
                  className={`copy-btn ${copied === 'HSL' ? 'copied' : ''}`}
                  onClick={() => copyToClipboard(formatHsl(), 'HSL')}
                >
                  {copied === 'HSL' ? '✓' : '复制'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="palette">
          {['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899'].map(c => (
            <button
              key={c}
              className="palette-color"
              style={{ backgroundColor: c }}
              onClick={() => handleHexChange(c)}
              title={c}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
