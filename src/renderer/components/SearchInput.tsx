interface SearchInputProps {
  value: string
  onChange: (value: string) => void
}

function SearchInput({ value, onChange }: SearchInputProps) {
  return (
    <div className="search-box">
      <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="text"
        className="search-input"
        placeholder="输入关键词搜索插件..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
    </div>
  )
}

export default SearchInput

