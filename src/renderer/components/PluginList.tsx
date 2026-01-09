import { useState, useEffect, useCallback } from 'react'
import { PluginInfo } from '../../shared/types/electron'

interface PluginListProps {
  query: string
}

function PluginList({ query }: PluginListProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
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
          setSelectedIndex(i => Math.min(plugins.length - 1, i + 1))
          break
        case 'Enter':
          e.preventDefault()
          if (plugins[selectedIndex]) {
            handleRun(plugins[selectedIndex].name)
          }
          break
        case 'Escape':
          window.electronAPI.window.hide()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [plugins, selectedIndex])

  const loadPlugins = async () => {
    const result = query
      ? await window.electronAPI.plugin.search(query)
      : await window.electronAPI.plugin.getAll()
    setPlugins(result)
    setSelectedIndex(0)
  }

  const handleRun = async (name: string) => {
    const result = await window.electronAPI.plugin.run(name)
    if (result.success) {
      window.electronAPI.window.hide()
    } else {
      console.error('Plugin error:', result.error)
    }
  }

  return (
    <div className="plugin-list">
      {plugins.map((plugin, index) => (
        <div
          key={plugin.name}
          className={`plugin-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => handleRun(plugin.name)}
        >
          <span className="plugin-name">{plugin.displayName}</span>
          <span className="plugin-keyword">{plugin.triggers[0]?.value}</span>
        </div>
      ))}
    </div>
  )
}

export default PluginList
