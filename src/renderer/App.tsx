import { useState, useEffect } from 'react'
import SearchInput from './components/SearchInput'
import PluginList from './components/PluginList'

function App() {
  const [query, setQuery] = useState('')
  const [showList, setShowList] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // 调整窗口高度
  useEffect(() => {
    const height = showList ? 300 : 62
    window.intools.window.setSize(680, height)
  }, [showList])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setShowList(value.length > 0)
  }

  // 拖拽安装插件
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (file?.path?.endsWith('.inplugin')) {
      const result = await window.intools.plugin.install(file.path)
      if (result.success) {
        window.intools.notification.show(`插件 ${result.pluginName} 安装成功`)
      } else {
        window.intools.notification.show(result.error || '安装失败', 'error')
      }
    }
  }

  return (
    <div
      className={`app ${isDragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <SearchInput value={query} onChange={handleQueryChange} />
      {showList && <PluginList query={query} />}
      {isDragging && <div className="drop-hint">拖放 .inplugin 文件安装插件</div>}
    </div>
  )
}

export default App
