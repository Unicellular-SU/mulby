import { useRef, useEffect } from 'react'

interface PluginInfo {
  pluginName: string
  displayName: string
  featureCode: string
  input: string
  uiPath: string
  preloadPath: string
}

interface PluginContainerProps {
  plugin: PluginInfo
  theme: 'light' | 'dark'
  onClose: () => void
}

// SVG Icons - Using Lucide-style icons
const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

function PluginContainer({ plugin, theme, onClose }: PluginContainerProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null)

  // 当 webview 准备好时，发送初始化数据和主题
  useEffect(() => {
    const webview = webviewRef.current
    if (webview) {
      webview.addEventListener('dom-ready', () => {
        webview.send('theme:changed', theme)
        // 发送插件初始化数据，包含用户输入
        webview.send('plugin:init', {
          pluginName: plugin.pluginName,
          featureCode: plugin.featureCode,
          input: plugin.input,
          mode: 'attached'
        })
      })
    }
  }, [])

  // 主题变化时发送消息给 webview
  useEffect(() => {
    const webview = webviewRef.current
    if (webview) {
      try {
        webview.send('theme:changed', theme)
      } catch {
        // webview 可能还没准备好
      }
    }
  }, [theme])

  const handleDetach = () => {
    window.intools.window.detach()
  }

  const handleClose = () => {
    window.intools.window.close()
    onClose()
  }

  // 构建带主题参数的 URL
  const uiUrl = `file://${plugin.uiPath}?theme=${theme}`

  return (
    <div className="plugin-container">
      <div className="plugin-header">
        <button
          className="detach-btn"
          onClick={handleDetach}
          title="独立窗口"
          aria-label="在独立窗口中打开"
        >
          <ExternalLinkIcon />
          <span>独立</span>
        </button>
        <span className="plugin-title">{plugin.displayName}</span>
        <button
          className="close-btn"
          onClick={handleClose}
          title="关闭"
          aria-label="关闭插件"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="plugin-content">
        <webview
          ref={webviewRef}
          src={uiUrl}
          preload={`file://${plugin.preloadPath}`}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  )
}

export default PluginContainer
