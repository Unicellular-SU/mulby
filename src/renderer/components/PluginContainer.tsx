import { useRef, useEffect } from 'react'

interface PluginInfo {
  pluginName: string
  displayName: string
  featureCode: string
  input: string
  uiPath: string
}

interface PluginContainerProps {
  plugin: PluginInfo
  theme: 'light' | 'dark'
  onClose: () => void
}

function PluginContainer({ plugin, theme, onClose }: PluginContainerProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null)

  // 当主题变化时通知 webview
  useEffect(() => {
    const webview = webviewRef.current
    if (webview) {
      webview.addEventListener('dom-ready', () => {
        webview.send('theme:changed', theme)
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
        <button className="detach-btn" onClick={handleDetach} title="独立窗口">
          📌 独立
        </button>
        <span className="plugin-title">{plugin.displayName}</span>
        <button className="close-btn" onClick={handleClose} title="关闭">
          ×
        </button>
      </div>
      <div className="plugin-content">
        <webview
          ref={webviewRef}
          src={uiUrl}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  )
}

export default PluginContainer
