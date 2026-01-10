interface PluginInfo {
  pluginName: string
  displayName: string
  featureCode: string
  input: string
  uiPath: string
}

interface PluginContainerProps {
  plugin: PluginInfo
  onClose: () => void
}

function PluginContainer({ plugin, onClose }: PluginContainerProps) {
  const handleDetach = () => {
    window.intools.window.detach()
  }

  const handleClose = () => {
    window.intools.window.close()
    onClose()
  }

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
          src={`file://${plugin.uiPath}`}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  )
}

export default PluginContainer
