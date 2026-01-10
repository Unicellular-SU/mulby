import { useState, useEffect } from 'react'
import { SearchResultItem } from '../../shared/types/electron'

interface PluginListProps {
  query: string
  onResultsChange?: (count: number) => void
}

// 插件图标组件
function PluginIcon({ icon }: { icon?: SearchResultItem['icon'] }) {
  if (!icon) {
    // 默认图标
    return (
      <div className="plugin-icon plugin-icon-default">
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      </div>
    )
  }

  if (icon.type === 'svg') {
    return (
      <div
        className="plugin-icon"
        dangerouslySetInnerHTML={{ __html: icon.value }}
      />
    )
  }

  // url 或 data-url
  return (
    <div className="plugin-icon">
      <img src={icon.value} alt="" width="20" height="20" />
    </div>
  )
}

function PluginList({ query, onResultsChange }: PluginListProps) {
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
    onResultsChange?.(result.length)
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
          <PluginIcon icon={item.icon} />
          <span className="plugin-name">{item.displayName}</span>
          <span className="plugin-keyword">{item.featureExplain}</span>
        </div>
      ))}
    </div>
  )
}

export default PluginList
