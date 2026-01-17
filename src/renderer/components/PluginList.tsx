import { useState, useEffect } from 'react'
import { SearchResultItem } from '../../shared/types/electron'
import type { InputPayload } from '../../shared/types/plugin'

interface PluginListProps {
  payload: InputPayload
  onResultsChange?: (count: number) => void
  onShowDetails?: (pluginName: string) => void
  onOpenSettings?: () => void
}

// 插件图标组件
function PluginIcon({ icon }: { icon?: SearchResultItem['icon'] }) {
  if (!icon) {
    // 默认图标
    return (
      <div className="plugin-icon plugin-icon-default">
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
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

function PluginList({ payload, onResultsChange, onShowDetails, onOpenSettings }: PluginListProps) {
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Grid 配置
  const COLUMNS = 6
  const MAX_ITEMS = 24 // 4行 × 6列
  const SEARCH_DEBOUNCE_MS = 150

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPlugins()
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [payload])

  // 键盘导航 - 支持四向移动
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const maxIndex = Math.min(results.length, MAX_ITEMS) - 1

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(i => {
            const newIndex = i - COLUMNS
            return newIndex >= 0 ? newIndex : i
          })
          break
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(i => {
            const newIndex = i + COLUMNS
            return newIndex <= maxIndex ? newIndex : i
          })
          break
        case 'ArrowLeft':
          e.preventDefault()
          setSelectedIndex(i => Math.max(0, i - 1))
          break
        case 'ArrowRight':
          e.preventDefault()
          setSelectedIndex(i => Math.min(maxIndex, i + 1))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            handleRun(results[selectedIndex])
          }
          break
        case 'i':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            const current = results[selectedIndex]
            if (current && !isSettingsItem(current)) {
              onShowDetails?.(current.pluginName)
            }
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [results, selectedIndex, onShowDetails]) // Added onShowDetails to deps

  const loadPlugins = async () => {
    const result = await window.intools.plugin.search(payload)
    const combined = injectSettingsResult(result, payload.text)
    setResults(combined)
    setSelectedIndex(0)
    onResultsChange?.(combined.length)
  }

  const handleRun = async (item: SearchResultItem) => {
    if (isSettingsItem(item)) {
      onOpenSettings?.()
      return
    }
    const result = await window.intools.plugin.run(item.pluginId, item.featureCode, payload)
    if (result.success) {
      // 有 UI 的插件不隐藏窗口，会显示在附着区域
      if (!result.hasUI) {
        window.intools.window.hide()
      }
    } else {
      console.error('Plugin error:', result.error)
    }
  }

  // 只显示最多 MAX_ITEMS 个结果
  const displayResults = results.slice(0, MAX_ITEMS)

  // 没有结果时不渲染任何内容
  if (displayResults.length === 0) {
    return null
  }

  return (
    <div className="plugin-grid">
      {displayResults.map((item, index) => (
        <div
          key={`${item.pluginName}-${item.featureCode}`}
          className={`plugin-card ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => handleRun(item)}
          onContextMenu={(e) => {
            e.preventDefault()
            if (!isSettingsItem(item)) {
              onShowDetails?.(item.pluginName)
            }
          }}
        >
          <PluginIcon icon={item.icon} />
          <span className="plugin-card-name">{item.displayName}</span>
          <span className="plugin-card-explain">{item.featureExplain}</span>
        </div>
      ))}
    </div>
  )
}

export default PluginList

const SETTINGS_ITEM_ID = '__system_settings__'

const SETTINGS_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c0 .7.4 1.3 1.1 1.6.2.1.4.1.6.1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
</svg>
`.trim()

function isSettingsItem(item: SearchResultItem) {
  return item.pluginId === SETTINGS_ITEM_ID
}

function injectSettingsResult(results: SearchResultItem[], queryText: string) {
  const text = queryText.trim().toLowerCase()
  if (!text) return results

  const keywordMatch = /(settings|setting|preferences|prefs|设置|偏好)/i.test(text)
  if (!keywordMatch) return results

  const exists = results.some((item) => item.pluginId === SETTINGS_ITEM_ID)
  if (exists) return results

  const settingsItem: SearchResultItem = {
    pluginId: SETTINGS_ITEM_ID,
    pluginName: SETTINGS_ITEM_ID,
    displayName: '设置',
    featureCode: 'settings',
    featureExplain: '打开设置面板',
    matchType: 'keyword',
    icon: { type: 'svg', value: SETTINGS_ICON_SVG }
  }

  return [settingsItem, ...results]
}
