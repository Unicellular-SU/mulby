import { useState, useEffect, useRef, useCallback } from 'react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
}

// intoolsMain 类型声明
declare global {
  interface Window {
    intoolsMain?: {
      subInput: {
        onEnabled: (callback: (data: { placeholder: string; isFocus: boolean }) => void) => void
        onDisabled: (callback: () => void) => void
        onSetValue: (callback: (text: string) => void) => void
        onFocus: (callback: () => void) => void
        onBlur: (callback: () => void) => void
        onSelect: (callback: () => void) => void
        sendChange: (text: string) => void
      }
    }
  }
}

interface SubInputState {
  enabled: boolean
  placeholder: string
}

function SearchInput({ value, onChange }: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [subInput, setSubInput] = useState<SubInputState>({ enabled: false, placeholder: '' })
  const [subInputValue, setSubInputValue] = useState('')

  // 监听 SubInput 事件
  useEffect(() => {
    const api = window.intoolsMain?.subInput
    if (!api) return

    api.onEnabled((data) => {
      setSubInput({ enabled: true, placeholder: data.placeholder })
      setSubInputValue('')
      if (data.isFocus && inputRef.current) {
        inputRef.current.focus()
      }
    })

    api.onDisabled(() => {
      setSubInput({ enabled: false, placeholder: '' })
      setSubInputValue('')
    })

    api.onSetValue((text) => {
      setSubInputValue(text)
    })

    api.onFocus(() => {
      inputRef.current?.focus()
    })

    api.onBlur(() => {
      inputRef.current?.blur()
    })

    api.onSelect(() => {
      inputRef.current?.select()
    })
  }, [])

  // 处理输入变化
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    if (subInput.enabled) {
      // SubInput 模式：更新本地值并通知主进程转发给插件
      setSubInputValue(text)
      window.intoolsMain?.subInput.sendChange(text)
    } else {
      // 正常模式：调用父组件回调
      onChange(text)
    }
  }, [subInput.enabled, onChange])

  return (
    <div className="search-box">
      <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        placeholder={subInput.enabled ? subInput.placeholder : '输入关键词搜索插件...'}
        value={subInput.enabled ? subInputValue : value}
        onChange={handleInputChange}
        autoFocus
      />
      {subInput.enabled && (
        <div className="subinput-indicator" title="SubInput 模式">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </div>
      )}
    </div>
  )
}

export default SearchInput

