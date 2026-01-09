interface PluginListProps {
  query: string
}

const mockPlugins = [
  { id: '1', name: 'JSON 格式化', keyword: 'json' },
  { id: '2', name: '时间戳转换', keyword: 'ts' },
  { id: '3', name: 'Base64 编解码', keyword: 'b64' }
]

function PluginList({ query }: PluginListProps) {
  const filtered = mockPlugins.filter((p) =>
    p.name.includes(query) || p.keyword.includes(query)
  )

  return (
    <div className="plugin-list">
      {filtered.map((plugin, index) => (
        <div
          key={plugin.id}
          className={`plugin-item ${index === 0 ? 'selected' : ''}`}
        >
          <span className="plugin-name">{plugin.name}</span>
          <span className="plugin-keyword">{plugin.keyword}</span>
        </div>
      ))}
    </div>
  )
}

export default PluginList
