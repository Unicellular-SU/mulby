import { useState, useEffect } from 'react'
import SearchInput from './components/SearchInput'
import PluginList from './components/PluginList'

function App() {
  const [query, setQuery] = useState('')
  const [showList, setShowList] = useState(false)

  // 调整窗口高度
  useEffect(() => {
    const height = showList ? 300 : 62
    window.electronAPI.window.setSize(680, height)
  }, [showList])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setShowList(value.length > 0)
  }

  return (
    <div className="app">
      <SearchInput value={query} onChange={handleQueryChange} />
      {showList && <PluginList query={query} />}
    </div>
  )
}

export default App
