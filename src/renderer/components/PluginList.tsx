import { useState, useEffect } from 'react'
import { SearchResultItem } from '../../shared/types/electron'

interface PluginListProps {
  query: string
}

function PluginList({ query }: PluginListProps) {
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    loadPlugins()
  }, [query])

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(i => Math.max(0, i - 1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(i => Math.min(results.length - 1, i + 1))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            handleRun(results[selectedIndex])
          }
          break
        case 'Escape':
          window.intools.window.hide()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [results, selectedIndex])

  const loadPlugins = async () => {
    const result = await window.intools.plugin.search(query)
    setResults(result)
    setSelectedIndex(0)
  }

  const handleRun = async (item: SearchResultItem) => {
    const result = await window.intools.plugin.run(item.pluginName, item.featureCode, query)
    if (result.success) {
      // 有 UI 的插件不隐藏窗口，会显示在附着区域
      if (!result.hasUI) {
        window.intools.window.hide()
      }
    } else {
      console.error('Plugin error:', result.error)
    }
  }

  return (
    <div className="plugin-list">
      {results.map((item, index) => (
        <div
          key={`${item.pluginName}-${item.featureCode}`}
          className={`plugin-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => handleRun(item)}
        >
          <span className="plugin-name">{item.displayName}</span>
          <span className="plugin-keyword">{item.featureExplain}</span>
        </div>
      ))}
    </div>
  )
}

export default PluginList
