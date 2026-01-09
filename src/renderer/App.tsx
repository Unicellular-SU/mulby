import { useState } from 'react'
import SearchInput from './components/SearchInput'
import PluginList from './components/PluginList'

function App() {
  const [query, setQuery] = useState('')
  const [showList, setShowList] = useState(false)

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
