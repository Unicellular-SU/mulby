import { useState, useEffect } from 'react'
import SearchInput from './components/SearchInput'
import PluginList from './components/PluginList'
import PluginContainer from './components/PluginContainer'

interface PluginInfo {
  pluginName: string
  displayName: string
  featureCode: string
  input: string
  uiPath: string
}

function App() {
  const [query, setQuery] = useState('')
  const [showList, setShowList] = useState(false)
  const [pluginInfo, setPluginInfo] = useState<PluginInfo | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  // 初始化主题
  useEffect(() => {
    window.intools.theme.getActual().then(setTheme)
    window.intools.onThemeChange(setTheme)
  }, [])

  // 应用主题到 document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // 调整窗口高度
  useEffect(() => {
    let height = 62
    if (pluginInfo) {
      height = 400
    } else if (showList) {
      height = 300
    }
    window.intools.window.setSize(680, height)
  }, [showList, pluginInfo])

  // 监听插件附着事件
  useEffect(() => {
    window.intools.onPluginAttach((data) => {
      setPluginInfo(data)
      setShowList(false)
    })

    window.intools.onPluginDetached(() => {
      setPluginInfo(null)
    })
  }, [])

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

  const handlePluginClose = () => {
    setPluginInfo(null)
    setQuery('')
  }

  return (
    <div
      className={`app ${isDragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <SearchInput value={query} onChange={handleQueryChange} />
      {showList && !pluginInfo && <PluginList query={query} />}
      {pluginInfo && <PluginContainer plugin={pluginInfo} theme={theme} onClose={handlePluginClose} />}
      {isDragging && <div className="drop-hint">拖放 .inplugin 文件安装插件</div>}
    </div>
  )
}

export default App
