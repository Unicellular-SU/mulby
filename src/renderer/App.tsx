import { useState, useEffect } from 'react'
import SearchInput from './components/SearchInput'
import PluginList from './components/PluginList'
import PluginDetails from './components/PluginDetails'

// 插件附着信息（Panel 模式）
interface PluginInfo {
  pluginName: string
  displayName: string
  featureCode: string
  input: string
  mode: 'panel'
}

function App() {
  const [query, setQuery] = useState('')
  const [resultCount, setResultCount] = useState(0)
  const [pluginOpen, setPluginOpen] = useState(false) // 仅用于跟踪插件是否打开
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

    if (detailsPluginName) {
      // 插件详情页
      height = 700
    } else if (pluginOpen) {
      // 插件面板打开时，主窗口只保持搜索框高度（插件 UI 在独立的 Panel 窗口中）
      height = SEARCH_BOX_HEIGHT
    } else if (query.length > 0 && resultCount > 0) {
      // 根据结果数量动态计算高度，最多显示 4 行
      const visibleCount = Math.min(resultCount, MAX_ITEMS)
      const rows = Math.ceil(visibleCount / COLUMNS)
      height = SEARCH_BOX_HEIGHT + BORDER_HEIGHT + GRID_PADDING * 2 +
        rows * CARD_HEIGHT + (rows - 1) * GRID_GAP
    }
    window.intools.window.setSize(680, height)
  }, [query, resultCount, pluginOpen, detailsPluginName])

  // 监听插件附着事件
  useEffect(() => {
    window.intools.onPluginAttach((_data: PluginInfo) => {
      setPluginOpen(true)
    })

    window.intools.onPluginDetached(() => {
      setPluginOpen(false)
    })
  }, [])

  // ESC 键分级退出处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (pluginOpen) {
          // 1. 优先关闭插件
          window.intools.window.close()
        } else if (query.length > 0) {
          // 2. 清空搜索框
          setQuery('')
          setResultCount(0)
        } else {
          // 3. 隐藏窗口
          window.intools.window.hide()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pluginOpen, query])

  const handleQueryChange = (value: string) => {
    // 如果有附着的插件，先关闭它
    if (pluginOpen) {
      window.intools.window.close()
      setPluginOpen(false)
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
      {query.length > 0 && !pluginOpen && (
        <PluginList
          query={query}
          onResultsChange={setResultCount}
          onShowDetails={setDetailsPluginName}
        />
      )}
      {isDragging && <div className="drop-hint">拖放 .inplugin 文件安装插件</div>}
    </div>
  )
}

export default App
