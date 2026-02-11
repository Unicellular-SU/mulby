import { useEffect, useState, useCallback } from 'react'
import { useMulby } from './hooks/useMulby'
import './App.css'

// 正则匹配结果类型
interface MatchResult {
  match: string
  index: number
  groups: string[]
}

// 常用正则模式 - 重新设计
const COMMON_PATTERNS = [
  { 
    name: '邮箱地址', 
    pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b', 
    flags: 'gi',
    icon: '✉️'
  },
  { 
    name: 'URL地址', 
    pattern: 'https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)', 
    flags: 'gi',
    icon: '🔗'
  },
  { 
    name: '手机号码', 
    pattern: '1[3-9]\\d{9}', 
    flags: 'g',
    icon: '📱'
  },
  { 
    name: '身份证号', 
    pattern: '\\d{17}[\\dXx]|\\d{15}', 
    flags: 'g',
    icon: '🆔'
  },
  { 
    name: 'IP地址', 
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', 
    flags: 'g',
    icon: '🌐'
  },
  { 
    name: 'HTML标签', 
    pattern: '<[^>]+>', 
    flags: 'g',
    icon: '🏷️'
  },
  { 
    name: '中文字符', 
    pattern: '[\\u4e00-\\u9fff]', 
    flags: 'g',
    icon: '🇨🇳'
  },
  { 
    name: '数字', 
    pattern: '\\d+', 
    flags: 'g',
    icon: '🔢'
  },
  { 
    name: '单词', 
    pattern: '\\b\\w+\\b', 
    flags: 'g',
    icon: '📝'
  },
  { 
    name: '空白行', 
    pattern: '^\\s*$', 
    flags: 'gm',
    icon: '📄'
  }
]

// 正则标志选项
const FLAG_OPTIONS = [
  { value: 'g', label: '全局匹配', description: '查找所有匹配' },
  { value: 'i', label: '忽略大小写', description: '不区分大小写' },
  { value: 'm', label: '多行模式', description: '^和$匹配行首行尾' },
  { value: 's', label: '点号匹配换行', description: '.匹配包括换行符' },
  { value: 'u', label: 'Unicode模式', description: '支持Unicode字符' },
  { value: 'y', label: '粘性匹配', description: '从lastIndex开始匹配' }
]

export default function App() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testText, setTestText] = useState('')
  const [matches, setMatches] = useState<MatchResult[]>([])
  const [error, setError] = useState('')
  const [isValid, setIsValid] = useState(true)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [showPatterns, setShowPatterns] = useState(true)
  const { clipboard, notification } = useMulby('reg_helper')

  // 初始化
  useEffect(() => {
    // 获取初始主题
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    // 监听主题变化
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据
    window.mulby?.onPluginInit?.((data: any) => {
      if (data.input) {
        setTestText(data.input)
      }
    })
  }, [])

  // 验证并执行正则匹配
  const validateAndMatch = useCallback(() => {
    if (!pattern.trim()) {
      setMatches([])
      setError('')
      setIsValid(true)
      return
    }

    try {
      const regex = new RegExp(pattern, flags)
      setIsValid(true)
      setError('')
      
      const results: MatchResult[] = []
      let match
      
      // 重置正则的lastIndex（对于全局匹配很重要）
      regex.lastIndex = 0
      
      while ((match = regex.exec(testText)) !== null) {
        results.push({
          match: match[0],
          index: match.index,
          groups: match.slice(1)
        })
        
        // 如果非全局匹配，只匹配一次
        if (!flags.includes('g')) break
      }
      
      setMatches(results)
    } catch (err: any) {
      setIsValid(false)
      setError(err.message)
      setMatches([])
    }
  }, [pattern, flags, testText])

  // 当pattern、flags或testText变化时自动匹配
  useEffect(() => {
    validateAndMatch()
  }, [validateAndMatch])

  // 应用常用模式
  const applyPattern = (pattern: string, patternFlags: string) => {
    setPattern(pattern)
    setFlags(patternFlags)
    notification.show('已应用模式')
  }

  // 切换标志
  const toggleFlag = (flag: string) => {
    if (flags.includes(flag)) {
      setFlags(flags.replace(flag, ''))
    } else {
      setFlags(flags + flag)
    }
  }

  // 复制正则表达式
  const copyRegex = async () => {
    const regexString = `/${pattern}/${flags}`
    await clipboard.writeText(regexString)
    notification.show('正则表达式已复制到剪贴板', 'success')
  }

  // 复制匹配结果
  const copyMatches = async () => {
    const matchesText = matches.map(m => m.match).join('\n')
    await clipboard.writeText(matchesText)
    notification.show(`已复制 ${matches.length} 个匹配结果`, 'success')
  }

  // 获取高亮文本
  const getHighlightedText = () => {
    if (!pattern || !isValid || matches.length === 0) {
      return <span className="empty-text">{testText || '输入文本以查看匹配结果...'}</span>
    }

    let lastIndex = 0
    const parts = []
    
    matches.forEach((match, index) => {
      // 添加匹配前的文本
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${index}`}>{testText.substring(lastIndex, match.index)}</span>)
      }
      
      // 添加高亮的匹配文本
      parts.push(
        <span key={`match-${index}`} className="regex-match">
          {match.match}
        </span>
      )
      
      lastIndex = match.index + match.match.length
    })
    
    // 添加剩余的文本
    if (lastIndex < testText.length) {
      parts.push(<span key="text-end">{testText.substring(lastIndex)}</span>)
    }
    
    return parts
  }

  return (
    <div className="app">
      <div className="container">
        {/* 侧边栏 */}
        <div className="sidebar">
          {/* 常用模式面板 */}
          <div className={`patterns-panel glass ${showPatterns ? 'expanded' : 'collapsed'}`}>
            <div className="panel-header">
              <div className="panel-title">常用模式</div>
              <button 
                className={`toggle-btn ${showPatterns ? 'expanded' : ''}`}
                onClick={() => setShowPatterns(!showPatterns)}
              >
                {showPatterns ? '收起' : '展开'}
              </button>
            </div>
            
            {showPatterns && (
              <div className="patterns-grid">
                {COMMON_PATTERNS.map((item, index) => (
                  <div
                    key={index}
                    className="pattern-card glass"
                    onClick={() => applyPattern(item.pattern, item.flags)}
                    title={`${item.name}: /${item.pattern}/${item.flags}`}
                  >
                    <div className="pattern-name">
                      <span style={{ marginRight: '6px' }}>{item.icon}</span>
                      {item.name}
                    </div>
                    <div className="pattern-preview">/{item.pattern}/</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 标志面板 */}
          <div className="flags-panel glass">
            <div className="flags-title">匹配标志</div>
            <div className="flags-grid">
              {FLAG_OPTIONS.map((flag) => (
                <div key={flag.value} className="has-tooltip">
                  <button
                    className={`flag-btn ${flags.includes(flag.value) ? 'active' : ''}`}
                    onClick={() => toggleFlag(flag.value)}
                  >
                    {flag.value}
                    <div className="tooltip">
                      <div className="tooltip-title">{flag.label}</div>
                      <div className="tooltip-desc">{flag.description}</div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 主内容区 */}
        <div className="main-content">
          {/* 正则输入面板 */}
          <div className="regex-panel glass">
            <div className="panel-title-large">正则表达式编辑器</div>
            
            <div className="regex-input-container">
              <span className="regex-slash">/</span>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="输入正则表达式..."
                className="regex-input"
              />
              <span className="regex-slash">/</span>
              <input
                type="text"
                value={flags}
                onChange={(e) => setFlags(e.target.value)}
                placeholder="flags"
                className="flags-input"
                maxLength={6}
              />
            </div>
            
            <div className={`status-indicator ${isValid ? 'valid' : 'invalid'}`}>
              <div className="status-dot"></div>
              <span>
                {isValid 
                  ? `正则表达式有效 (${matches.length} 个匹配)` 
                  : `错误: ${error}`
                }
              </span>
            </div>
          </div>

          {/* 测试文本面板 */}
          <div className="test-text-panel glass">
            <div className="test-text-title">测试文本</div>
            <textarea
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder="在此输入或粘贴要测试的文本..."
              className="test-textarea"
              rows={6}
            />
          </div>

          {/* 匹配结果面板 */}
          <div className="results-panel glass">
            <div className="results-header">
              <div className="results-title">匹配结果</div>
              <div className="results-count">{matches.length} 个匹配</div>
            </div>
            
            <div className="highlighted-text">
              {getHighlightedText()}
            </div>

            {/* 匹配详情 */}
            {matches.length > 0 && (
              <div className="matches-details">
                <div className="matches-list">
                  {matches.map((match, index) => (
                    <div key={index} className="match-card">
                      <div className="match-header">
                        <span className="match-index">#{index + 1}</span>
                        <span className="match-position">位置: {match.index}</span>
                        <span className="match-length">长度: {match.match.length}</span>
                      </div>
                      <div className="match-content">{match.match}</div>
                      {match.groups.length > 0 && (
                        <div className="match-groups">
                          <div className="groups-label">捕获组:</div>
                          {match.groups.map((group, groupIndex) => (
                            <div key={groupIndex} className="group-item">
                              <span className="group-index">${groupIndex + 1}</span>
                              <span className="group-value">{group || '(空)'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 操作按钮面板 */}
          <div className="actions-panel glass">
            <div className="actions-grid">
              <button className="action-btn" onClick={copyRegex}>
                <div className="action-icon">📋</div>
                <div className="action-label">复制正则</div>
                <div className="action-subtext">/{pattern}/{flags}</div>
              </button>
              
              <button 
                className="action-btn" 
                onClick={copyMatches}
                disabled={matches.length === 0}
              >
                <div className="action-icon">📄</div>
                <div className="action-label">复制匹配</div>
                <div className="action-subtext">{matches.length} 个结果</div>
              </button>
            </div>
          </div>

          {/* 信息面板 */}
          <div className="info-panel glass">
            <div className="info-grid">
              <div className="info-card">
                <div className="info-label">完整正则</div>
                <div className="info-value">/{pattern}/{flags}</div>
              </div>
              
              <div className="info-card">
                <div className="info-label">转义字符串</div>
                <div className="info-value">{pattern.replace(/\\/g, '\\\\')}</div>
              </div>
              
              <div className="info-card">
                <div className="info-label">状态</div>
                <div className="info-value">
                  <span style={{ 
                    color: isValid ? 'var(--color-success)' : 'var(--color-error)',
                    fontWeight: 600
                  }}>
                    {isValid ? '✓ 有效' : '✗ 无效'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}