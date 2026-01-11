import { useState, useEffect } from 'react'
import SearchInput from './components/SearchInput'
import PluginList from './components/PluginList'
import PluginContainer from './components/PluginContainer'
import PluginDetails from './components/PluginDetails'

interface PluginInfo {
  pluginName: string
  displayName: string
  featureCode: string
  input: string
  uiPath: string
  preloadPath: string
  mode?: 'panel' | 'webview' // Panel 模式不需要渲染 WebView
}

function App() {
  const [query, setQuery] = useState('')
  const [resultCount, setResultCount] = useState(0)
  const [pluginInfo, setPluginInfo] = useState<PluginInfo | null>(null)
  const [detailsPluginName, setDetailsPluginName] = useState<string | null>(null)
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
    const SEARCH_BOX_HEIGHT = 62
    const BORDER_HEIGHT = 1
    const GRID_GAP = 12
    const CARD_HEIGHT = 100 // 图标40 + 名称14 + explain12 + padding24 + gap6*2
    const GRID_PADDING = 16
    const COLUMNS = 6
    const MAX_ITEMS = 24 // 4行 × 6列

    let height = SEARCH_BOX_HEIGHT

    // Panel 模式：插件 UI 在独立窗口中，主窗口只保持搜索框高度
    if (pluginInfo && pluginInfo.mode === 'panel') {
      height = SEARCH_BOX_HEIGHT
    } else if (pluginInfo || detailsPluginName) {
      // WebView 模式：插件 UI 嵌入主窗口
      height = 700
    } else if (query.length > 0 && resultCount > 0) {
      // 根据结果数量动态计算高度，最多显示 4 行
      const visibleCount = Math.min(resultCount, MAX_ITEMS)
      const rows = Math.ceil(visibleCount / COLUMNS)
      height = SEARCH_BOX_HEIGHT + BORDER_HEIGHT + GRID_PADDING * 2 +
        rows * CARD_HEIGHT + (rows - 1) * GRID_GAP
    }
    window.intools.window.setSize(680, height)
  }, [query, resultCount, pluginInfo, detailsPluginName])

  // 监听插件附着事件
  useEffect(() => {
    window.intools.onPluginAttach((data) => {
      setPluginInfo(data)
    })

    window.intools.onPluginDetached(() => {
      setPluginInfo(null)
    })
  }, [])

  const handleQueryChange = (value: string) => {
    // 如果有附着的插件，先关闭它
    if (pluginInfo) {
      window.intools.window.close()
      setPluginInfo(null)
    }
    setQuery(value)
    if (value.length === 0) {
      setResultCount(0)
      setDetailsPluginName(null)
    }
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

  if (detailsPluginName) {
    return (
      <div className={`app ${isDragging ? 'dragging' : ''}`}>
        <PluginDetails
          pluginName={detailsPluginName}
          onBack={() => setDetailsPluginName(null)}
        />
      </div>
    )
  }

  return (
    <div
      className={`app ${isDragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <SearchInput value={query} onChange={handleQueryChange} />
      {query.length > 0 && !pluginInfo && (
        <PluginList
          query={query}
          onResultsChange={setResultCount}
          onShowDetails={setDetailsPluginName}
        />
      )}
      {/* 只在 WebView 模式下渲染 PluginContainer（Panel 模式有独立窗口） */}
      {pluginInfo && pluginInfo.mode !== 'panel' && pluginInfo.uiPath && (
        <PluginContainer plugin={pluginInfo} theme={theme} onClose={handlePluginClose} />
      )}
      {isDragging && <div className="drop-hint">拖放 .inplugin 文件安装插件</div>}
    </div>
  )
}

export default App
