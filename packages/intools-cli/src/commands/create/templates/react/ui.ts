/**
 * React 插件模板 - UI 代码生成器
 * 包含：index.html, main.tsx, App.tsx, styles.css
 */

/**
 * 生成 index.html 内容
 */
export function buildIndexHtml(name: string) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
`
}

/**
 * 生成 main.tsx 入口文件内容
 */
export function buildMainTsx() {
    return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
`
}

/**
 * 生成 App.tsx 主应用组件内容
 */
export function buildAppTsx(name: string) {
    return `import { useEffect, useState } from 'react'
import { FileText, Image } from 'lucide-react'
import { useIntools } from './hooks/useIntools'

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

export default function App() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const { clipboard, notification, host } = useIntools('${name}')

  useEffect(() => {
    // 获取初始主题（从 URL 参数）
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
      if (data.input) {
        setInput(data.input)
      }
      // 接收附件数据
      if (data.attachments) {
        setAttachments(data.attachments)
      }
    })
  }, [])

  const handleProcess = async () => {
    // 示例：将输入转为大写
    const result = input.toUpperCase()
    setOutput(result)

    // 复制到剪贴板并通知
    await clipboard.writeText(result)
    notification.show('已复制到剪贴板')
  }

  // 示例：调用后端 host 方法
  const handleCallHost = async () => {
    try {
      const result = await host.call('processData', { value: input })
      console.log('Host返回:', result.data)
      notification.show('后端处理成功')
    } catch (err: any) {
      notification.show(\`错误: \${err.message}\`, 'error')
    }
  }

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return \`\${bytes} B\`
    if (bytes < 1024 * 1024) return \`\${(bytes / 1024).toFixed(1)} KB\`
    return \`\${(bytes / 1024 / 1024).toFixed(1)} MB\`
  }

  return (
    <div className="app">

      <div className="container">
        {/* 附件展示区域 */}
        {attachments.length > 0 && (
          <div className="field">
            <label>附件 ({attachments.length})</label>
            <div className="attachments-list">
              {attachments.map((item, index) => (
                <div key={item.id || index} className="attachment-item">
                  <span className="attachment-icon">
                    {item.kind === 'image' ? <Image size={20} /> : <FileText size={20} />}
                  </span>
                  <div className="attachment-info">
                    <div className="attachment-name">{item.name}</div>
                    <div className="attachment-meta">{formatSize(item.size)}</div>
                  </div>
                  {item.kind === 'image' && (item.dataUrl || item.path) && (
                    <img
                      src={item.dataUrl || \`file://\${item.path}\`}
                      alt={item.name}
                      className="attachment-preview"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label>输入</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="请输入内容..."
          />
        </div>
        <div className="actions">
          <button className="btn-primary" onClick={handleProcess}>
            处理
          </button>
          <button className="btn-secondary" onClick={handleCallHost}>
            调用后端
          </button>
        </div>
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
`
}

/**
 * 生成 styles.css 全局样式内容
 */
export function buildStylesCss() {
    return `@tailwind base;
@tailwind components;
@tailwind utilities;

/* CSS 变量 - 亮色主题 */
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-tertiary: #ebebeb;
  --text-primary: #1e1e1e;
  --text-secondary: #666666;
  --text-tertiary: #999999;
  --border-color: #e0e0e0;
  --accent-color: #0078d4;
  --accent-hover: #1084d8;
}

/* CSS 变量 - 暗色主题 */
:root.dark {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2d2d2d;
  --bg-tertiary: #3d3d3d;
  --text-primary: #e0e0e0;
  --text-secondary: #999999;
  --text-tertiary: #666666;
  --border-color: #3d3d3d;
  --accent-color: #0078d4;
  --accent-hover: #1084d8;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  transition: background-color 0.2s, color 0.2s;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}



.container {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
}

.field label {
  font-size: 12px;
  color: var(--text-secondary);
}

.field textarea {
  flex: 1;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
  color: var(--text-primary);
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 13px;
  resize: none;
  outline: none;
  min-height: 80px;
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
}

.field textarea:focus {
  border-color: var(--accent-color);
}

.field textarea::placeholder {
  color: var(--text-tertiary);
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

button {
  padding: 8px 24px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary {
  background: var(--accent-color);
  color: #fff;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-secondary);
}

/* 附件列表样式 */
.attachments-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.attachment-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  gap: 10px;
}

.attachment-icon {
  font-size: 20px;
}

.attachment-info {
  flex: 1;
  min-width: 0;
}

.attachment-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attachment-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.attachment-preview {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
}
`
}
