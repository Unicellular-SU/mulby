import { useEffect, useState } from 'react'
import { useMulby } from './hooks/useMulby'
import './styles.css'

// 附件类型定义
interface Attachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'image'
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
  attachments?: Attachment[]
}

// 功能类型
type FeatureType = 'time' | 'base64' | 'url' | 'hash' | 'unicode' | 'uuid' | 'radix' | 'html'

// 哈希算法类型
type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512'

// 进制类型
type RadixType = 'binary' | 'octal' | 'decimal' | 'hexadecimal'

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [currentFeature, setCurrentFeature] = useState<FeatureType>('time')
  const [hashAlgorithm, setHashAlgorithm] = useState<HashAlgorithm>('md5')
  const [fromRadix, setFromRadix] = useState<RadixType>('decimal')
  const [toRadix, setToRadix] = useState<RadixType>('hexadecimal')
  const [timestampType, setTimestampType] = useState<'seconds' | 'milliseconds'>('seconds')
  const { clipboard, notification } = useMulby('encode_helper')

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
        setInput(data.input)
      }
      if (data.attachments) {
        setAttachments(data.attachments)
      }
      if (data.route) {
        const feature = data.route.substring(1) as FeatureType
        setCurrentFeature(feature)
      }
    })
  }, [])

  // 时间转换
  const convertTime = () => {
    if (!input.trim()) return ''
    
    const trimmedInput = input.trim()
    
    // 检查是否是时间戳
    if (/^\d+$/.test(trimmedInput)) {
      const timestamp = parseInt(trimmedInput)
      const date = timestampType === 'seconds' ? new Date(timestamp * 1000) : new Date(timestamp)
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
    } else {
      // 尝试解析日期字符串
      const date = new Date(trimmedInput)
      if (!isNaN(date.getTime())) {
        return timestampType === 'seconds' 
          ? Math.floor(date.getTime() / 1000).toString()
          : date.getTime().toString()
      }
    }
    
    return '无效的时间格式'
  }

  // Base64编码
  const encodeBase64 = () => {
    if (!input.trim()) return ''
    try {
      return btoa(unescape(encodeURIComponent(input)))
    } catch (e) {
      return '编码失败'
    }
  }

  // Base64解码
  const decodeBase64 = () => {
    if (!input.trim()) return ''
    try {
      return decodeURIComponent(escape(atob(input)))
    } catch (e) {
      return '解码失败'
    }
  }

  // URL编码
  const encodeURL = () => {
    if (!input.trim()) return ''
    return encodeURIComponent(input)
  }

  // URL解码
  const decodeURL = () => {
    if (!input.trim()) return ''
    try {
      return decodeURIComponent(input)
    } catch (e) {
      return '解码失败'
    }
  }

  // 哈希计算
  const calculateHash = async () => {
    if (!input.trim()) return ''
    
    const encoder = new TextEncoder()
    const data = encoder.encode(input)
    
    try {
      let hash: ArrayBuffer
      
      switch (hashAlgorithm) {
        case 'md5':
          // 注意：浏览器原生不支持MD5，这里使用SubtleCrypto的SHA-256替代
          hash = await crypto.subtle.digest('SHA-256', data)
          return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
        case 'sha1':
          hash = await crypto.subtle.digest('SHA-1', data)
          return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
        case 'sha256':
          hash = await crypto.subtle.digest('SHA-256', data)
          return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
        case 'sha512':
          hash = await crypto.subtle.digest('SHA-512', data)
          return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
        default:
          return '不支持的哈希算法'
      }
    } catch (e) {
      return '哈希计算失败'
    }
  }

  // Unicode编码
  const encodeUnicode = () => {
    if (!input.trim()) return ''
    return input.split('').map(char => 
      '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')
    ).join('')
  }

  // Unicode解码
  const decodeUnicode = () => {
    if (!input.trim()) return ''
    try {
      return input.replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) => 
        String.fromCharCode(parseInt(hex, 16))
      )
    } catch (e) {
      return '解码失败'
    }
  }

  // 生成UUID
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  // 进制转换
  const convertRadix = () => {
    if (!input.trim()) return ''
    
    const trimmedInput = input.trim()
    
    try {
      let decimalValue: number
      
      // 将输入转换为十进制
      switch (fromRadix) {
        case 'binary':
          decimalValue = parseInt(trimmedInput, 2)
          break
        case 'octal':
          decimalValue = parseInt(trimmedInput, 8)
          break
        case 'decimal':
          decimalValue = parseInt(trimmedInput, 10)
          break
        case 'hexadecimal':
          decimalValue = parseInt(trimmedInput, 16)
          break
        default:
          return '不支持的进制'
      }
      
      if (isNaN(decimalValue)) {
        return '无效的输入'
      }
      
      // 将十进制转换为目标进制
      switch (toRadix) {
        case 'binary':
          return decimalValue.toString(2)
        case 'octal':
          return decimalValue.toString(8)
        case 'decimal':
          return decimalValue.toString(10)
        case 'hexadecimal':
          return decimalValue.toString(16).toUpperCase()
        default:
          return '不支持的进制'
      }
    } catch (e) {
      return '转换失败'
    }
  }

  // HTML编码
  const encodeHTML = () => {
    if (!input.trim()) return ''
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // HTML解码
  const decodeHTML = () => {
    if (!input.trim()) return ''
    return input
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x([\dA-Fa-f]+);/g, (_, hex) => 
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/&#(\d+);/g, (_, dec) => 
        String.fromCharCode(parseInt(dec, 10))
      )
  }

  // 处理Base64加密
  const handleBase64Encode = async () => {
    const result = encodeBase64()
    setOutput(result)
    
    // 复制到剪贴板并通知
    if (result) {
      await clipboard.writeText(result)
      notification.show('已复制到剪贴板')
    }
  }

  // 处理Base64解密
  const handleBase64Decode = async () => {
    const result = decodeBase64()
    setOutput(result)
    
    // 复制到剪贴板并通知
    if (result) {
      await clipboard.writeText(result)
      notification.show('已复制到剪贴板')
    }
  }

  // 处理URL编码
  const handleURLEncode = async () => {
    const result = encodeURL()
    setOutput(result)
    
    // 复制到剪贴板并通知
    if (result) {
      await clipboard.writeText(result)
      notification.show('已复制到剪贴板')
    }
  }

  // 处理URL解码
  const handleURLDecode = async () => {
    const result = decodeURL()
    setOutput(result)
    
    // 复制到剪贴板并通知
    if (result) {
      await clipboard.writeText(result)
      notification.show('已复制到剪贴板')
    }
  }

  // 处理Unicode编码
  const handleUnicodeEncode = async () => {
    const result = encodeUnicode()
    setOutput(result)
    
    // 复制到剪贴板并通知
    if (result) {
      await clipboard.writeText(result)
      notification.show('已复制到剪贴板')
    }
  }

  // 处理Unicode解码
  const handleUnicodeDecode = async () => {
    const result = decodeUnicode()
    setOutput(result)
    
    // 复制到剪贴板并通知
    if (result) {
      await clipboard.writeText(result)
      notification.show('已复制到剪贴板')
    }
  }

  // 处理HTML编码
  const handleHTMLEncode = async () => {
    const result = encodeHTML()
    setOutput(result)
    
    // 复制到剪贴板并通知
    if (result) {
      await clipboard.writeText(result)
      notification.show('已复制到剪贴板')
    }
  }

  // 处理HTML解码
  const handleHTMLDecode = async () => {
    const result = decodeHTML()
    setOutput(result)
    
    // 复制到剪贴板并通知
    if (result) {
      await clipboard.writeText(result)
      notification.show('已复制到剪贴板')
    }
  }

  // 处理通用转换
  const handleProcess = async () => {
    let result = ''
    
    switch (currentFeature) {
      case 'time':
        result = convertTime()
        break
      case 'hash':
        result = await calculateHash()
        break
      case 'uuid':
        result = generateUUID()
        break
      case 'radix':
        result = convertRadix()
        break
      default:
        // 对于其他功能，使用自动检测
        if (currentFeature === 'base64') {
          // 尝试自动检测是编码还是解码
          if (/^[A-Za-z0-9+/]+={0,2}$/.test(input.trim())) {
            result = decodeBase64()
          } else {
            result = encodeBase64()
          }
        } else if (currentFeature === 'url') {
          // 尝试自动检测是编码还是解码
          if (/%[0-9A-Fa-f]{2}/.test(input)) {
            result = decodeURL()
          } else {
            result = encodeURL()
          }
        } else if (currentFeature === 'unicode') {
          // 尝试自动检测是编码还是解码
          if (/\\u[0-9A-Fa-f]{4}/.test(input)) {
            result = decodeUnicode()
          } else {
            result = encodeUnicode()
          }
        } else if (currentFeature === 'html') {
          // 尝试自动检测是编码还是解码
          if (/&[a-z]+;|&#x?[0-9A-Fa-f]+;/.test(input)) {
            result = decodeHTML()
          } else {
            result = encodeHTML()
          }
        }
        break
    }
    
    setOutput(result)
    
    // 复制到剪贴板并通知
    if (result) {
      await clipboard.writeText(result)
      notification.show('已复制到剪贴板')
    }
  }

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  // 渲染功能特定的控制面板
  const renderFeatureControls = () => {
    switch (currentFeature) {
      case 'time':
        return (
          <div className="feature-controls">
            <label>时间戳类型：</label>
            <select 
              value={timestampType}
              onChange={(e) => setTimestampType(e.target.value as 'seconds' | 'milliseconds')}
            >
              <option value="seconds">秒级时间戳</option>
              <option value="milliseconds">毫秒级时间戳</option>
            </select>
          </div>
        )
      case 'hash':
        return (
          <div className="feature-controls">
            <label>哈希算法：</label>
            <select 
              value={hashAlgorithm}
              onChange={(e) => setHashAlgorithm(e.target.value as HashAlgorithm)}
            >
              <option value="md5">MD5</option>
              <option value="sha1">SHA-1</option>
              <option value="sha256">SHA-256</option>
              <option value="sha512">SHA-512</option>
            </select>
          </div>
        )
      case 'radix':
        return (
          <div className="feature-controls">
            <div className="radix-controls">
              <div>
                <label>从：</label>
                <select 
                  value={fromRadix}
                  onChange={(e) => setFromRadix(e.target.value as RadixType)}
                >
                  <option value="binary">二进制</option>
                  <option value="octal">八进制</option>
                  <option value="decimal">十进制</option>
                  <option value="hexadecimal">十六进制</option>
                </select>
              </div>
              <div>
                <label>到：</label>
                <select 
                  value={toRadix}
                  onChange={(e) => setToRadix(e.target.value as RadixType)}
                >
                  <option value="binary">二进制</option>
                  <option value="octal">八进制</option>
                  <option value="decimal">十进制</option>
                  <option value="hexadecimal">十六进制</option>
                </select>
              </div>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  // 渲染功能特定的操作按钮
  const renderFeatureActions = () => {
    switch (currentFeature) {
      case 'base64':
        return (
          <div className="actions">
            <button className="btn-primary" onClick={handleBase64Encode}>
              加密 (Base64编码)
            </button>
            <button className="btn-primary" onClick={handleBase64Decode}>
              解密 (Base64解码)
            </button>
            <button className="btn-secondary" onClick={() => setInput('')}>
              清空
            </button>
          </div>
        )
      case 'url':
        return (
          <div className="actions">
            <button className="btn-primary" onClick={handleURLEncode}>
              编码 (URL编码)
            </button>
            <button className="btn-primary" onClick={handleURLDecode}>
              解码 (URL解码)
            </button>
            <button className="btn-secondary" onClick={() => setInput('')}>
              清空
            </button>
          </div>
        )
      case 'unicode':
        return (
          <div className="actions">
            <button className="btn-primary" onClick={handleUnicodeEncode}>
              编码 (Unicode编码)
            </button>
            <button className="btn-primary" onClick={handleUnicodeDecode}>
              解码 (Unicode解码)
            </button>
            <button className="btn-secondary" onClick={() => setInput('')}>
              清空
            </button>
          </div>
        )
      case 'html':
        return (
          <div className="actions">
            <button className="btn-primary" onClick={handleHTMLEncode}>
              编码 (HTML转义)
            </button>
            <button className="btn-primary" onClick={handleHTMLDecode}>
              解码 (HTML还原)
            </button>
            <button className="btn-secondary" onClick={() => setInput('')}>
              清空
            </button>
          </div>
        )
      default:
        return (
          <div className="actions">
            <button className="btn-primary" onClick={handleProcess}>
              转换
            </button>
            <button className="btn-secondary" onClick={() => setInput('')}>
              清空
            </button>
          </div>
        )
    }
  }

  // 获取功能描述
  const getFeatureDescription = () => {
    const descriptions = {
      time: '时间戳与日期时间相互转换',
      base64: 'Base64编码与解码',
      url: 'URL编码与解码',
      hash: '哈希加密计算',
      unicode: 'Unicode编码与解码',
      uuid: '生成UUID',
      radix: '进制转换',
      html: 'HTML实体编码与解码'
    }
    return descriptions[currentFeature]
  }

  return (
    <div className="app">
      <div className="titlebar">编码小助手 - {getFeatureDescription()}</div>
      <div className="container">
        {/* 功能选择 */}
        <div className="feature-selector">
          <div className="feature-tabs">
            {(['time', 'base64', 'url', 'hash', 'unicode', 'uuid', 'radix', 'html'] as FeatureType[]).map(feature => (
              <button
                key={feature}
                className={`feature-tab ${currentFeature === feature ? 'active' : ''}`}
                onClick={() => setCurrentFeature(feature)}
              >
                {feature === 'time' && '⏰ 时间'}
                {feature === 'base64' && '🔢 Base64'}
                {feature === 'url' && '🔗 URL'}
                {feature === 'hash' && '🔐 哈希'}
                {feature === 'unicode' && '🔤 Unicode'}
                {feature === 'uuid' && '🆔 UUID'}
                {feature === 'radix' && '🔢 进制'}
                {feature === 'html' && '📄 HTML'}
              </button>
            ))}
          </div>
        </div>

        {/* 附件展示区域 */}
        {attachments.length > 0 && (
          <div className="field">
            <label>附件 ({attachments.length})</label>
            <div className="attachments-list">
              {attachments.map((item, index) => (
                <div key={item.id || index} className="attachment-item">
                  <span className="attachment-icon">
                    {item.kind === 'image' ? '🖼️' : '📄'}
                  </span>
                  <div className="attachment-info">
                    <div className="attachment-name">{item.name}</div>
                    <div className="attachment-meta">{formatSize(item.size)}</div>
                  </div>
                  {item.kind === 'image' && (item.dataUrl || item.path) && (
                    <img
                      src={item.dataUrl || `file://${item.path}`}
                      alt={item.name}
                      className="attachment-preview"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 功能特定控制面板 */}
        {renderFeatureControls()}

        <div className="field">
          <label>输入</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="请输入内容..."
            autoFocus
          />
        </div>
        
        {/* 功能特定操作按钮 */}
        {renderFeatureActions()}
        
        <div className="field">
          <label>输出</label>
          <textarea
            value={output}
            readOnly
            placeholder="结果将显示在这里..."
          />
        </div>
      </div>
    </div>
  )
}