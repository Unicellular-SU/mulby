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
 * 通用数据展示型布局：接收主进程传递的文字、附件、图像，分类展示
 */
export function buildAppTsx(name: string) {
  return `import { useEffect, useState } from 'react'
import { FileText, Image, Copy, Inbox, Paperclip } from 'lucide-react'
import { useMulby } from './hooks/useMulby'

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
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const { clipboard, notification, host } = useMulby('${name}')

  // 按类型分组附件
  const images = attachments.filter((a) => a.kind === 'image')
  const files = attachments.filter((a) => a.kind === 'file')
  const hasContent = input || images.length > 0 || files.length > 0

  useEffect(() => {
    // 初始化主题
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    // 监听主题变化
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据
    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      if (data.input) setInput(data.input)
      if (data.attachments) setAttachments(data.attachments)
    })
  }, [])

  // 复制文本到剪贴板
  const handleCopyText = async () => {
    if (!input) return
    await clipboard.writeText(input)
    notification.show('已复制到剪贴板', 'success')
  }

  // 示例：调用后端 host 方法
  const handleCallHost = async () => {
    try {
      const result = await host.call('processData', { value: input })
      console.log('Host 返回:', result.data)
      notification.show('后端处理成功', 'success')
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
    <div className="plugin-root">
      {/* 头部 */}
      <header className="header">
        <h1 className="header-title">${name}</h1>
        {attachments.length > 0 && (
          <span className="badge">
            <Paperclip size={12} />
            {attachments.length}
          </span>
        )}
      </header>

      {/* 主内容区 */}
      <main className="main">
        {!hasContent ? (
          <div className="empty-state">
            <Inbox size={40} strokeWidth={1.5} />
            <p className="empty-title">暂无数据</p>
            <p className="empty-hint">等待主进程传入文字或附件</p>
          </div>
        ) : (
          <div className="content-flow">
            {/* 文本区域 */}
            {input && (
              <section className="section">
                <div className="section-head">
                  <h2>文本内容</h2>
                  <button className="btn-ghost" onClick={handleCopyText}>
                    <Copy size={13} />
                    复制
                  </button>
                </div>
                <div className="text-block">{input}</div>
              </section>
            )}

            {/* 图片网格 */}
            {images.length > 0 && (
              <section className="section">
                <div className="section-head">
                  <h2><Image size={14} /> 图片 ({images.length})</h2>
                </div>
                <div className="image-grid">
                  {images.map((img, i) => (
                    <div key={img.id || i} className="image-cell">
                      <img
                        src={img.dataUrl || \`file://\${img.path}\`}
                        alt={img.name}
                        loading="lazy"
                      />
                      <span className="image-name">{img.name}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 文件列表 */}
            {files.length > 0 && (
              <section className="section">
                <div className="section-head">
                  <h2><FileText size={14} /> 文件 ({files.length})</h2>
                </div>
                <div className="file-list">
                  {files.map((file, i) => (
                    <div key={file.id || i} className="file-row">
                      <FileText size={16} className="file-icon" />
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">{formatSize(file.size)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* 底部操作 */}
      <footer className="footer">
        <button className="btn-primary" onClick={handleCallHost}>调用后端</button>
        <button className="btn-secondary" onClick={handleCopyText} disabled={!input}>
          <Copy size={13} />
          复制文本
        </button>
      </footer>
    </div>
  )
}
`
}

/**
 * 生成 styles.css 全局样式内容
 * 扁平化设计：纯色背景、细边框、无投影/渐变/毛玻璃
 */
export function buildStylesCss() {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

/* ===== 亮色主题 ===== */
:root {
  --bg: #f7f8fa;
  --surface: #ffffff;
  --border: #e5e7eb;
  --border-hover: #d1d5db;
  --text-1: #1a1a1a;
  --text-2: #6b7280;
  --text-3: #9ca3af;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --accent-soft: rgba(59, 130, 246, 0.08);
  --tag-bg: rgba(59, 130, 246, 0.1);
  --tag-text: #2563eb;
}

/* ===== 暗色主题（与主进程 slate-blue 色调对齐） ===== */
:root.dark {
  --bg: #0f172a;
  --surface: #1e293b;
  --border: #334155;
  --border-hover: #475569;
  --text-1: #f1f5f9;
  --text-2: #94a3b8;
  --text-3: #64748b;
  --accent: #3b82f6;
  --accent-hover: #60a5fa;
  --accent-soft: rgba(59, 130, 246, 0.1);
  --tag-bg: rgba(59, 130, 246, 0.15);
  --tag-text: #93c5fd;
}

/* ===== 基础 ===== */
* { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root { width: 100%; height: 100%; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text-1);
}

/* ===== 整体布局 ===== */
.plugin-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100vh;
}

/* ===== 头部 ===== */
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.header-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--tag-bg);
  color: var(--tag-text);
  font-size: 11px;
  font-weight: 600;
}

/* ===== 主内容 ===== */
.main {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

/* ===== 空状态 ===== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  min-height: 180px;
  color: var(--text-3);
}

.empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
}

.empty-hint {
  font-size: 12px;
}

/* ===== 内容区 ===== */
.content-flow {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== Section ===== */
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-head h2 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

/* ===== 文本块 ===== */
.text-block {
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  max-height: 280px;
  overflow-y: auto;
}

/* ===== 图片网格 ===== */
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.image-cell {
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow: hidden;
  background: var(--surface);
  transition: border-color 150ms;
}

.image-cell:hover {
  border-color: var(--border-hover);
}

.image-cell img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

.image-name {
  display: block;
  padding: 5px 8px;
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== 文件列表 ===== */
.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  transition: background-color 120ms;
}

.file-row:hover {
  background: var(--accent-soft);
}

.file-icon {
  flex-shrink: 0;
  color: var(--text-3);
}

.file-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-size {
  font-size: 11px;
  color: var(--text-3);
  flex-shrink: 0;
}

/* ===== 按钮 ===== */
button {
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: background-color 120ms, opacity 120ms;
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--accent-soft);
  color: var(--accent);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--tag-bg);
}

.btn-ghost {
  background: transparent;
  color: var(--text-2);
  padding: 4px 8px;
  font-size: 12px;
}

.btn-ghost:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

/* ===== 底部 ===== */
.footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

/* ===== 响应式 ===== */
@media (max-width: 480px) {
  .header, .main, .footer { padding-left: 14px; padding-right: 14px; }
  .image-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
}

/* ===== 减少动画偏好 ===== */
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`
}
