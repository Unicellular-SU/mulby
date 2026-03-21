import { useState, useEffect, useCallback, useRef } from 'react'
import { normalizeShortcutKey } from './settings/utils'
import '../styles/onboarding.css'

// Mulby v1 图标 SVG 内联
const MulbyLogo = () => (
  <svg width="80" height="80" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="onboarding-logo">
    <g>
      <path d="M100 65 Q105 25 135 20 Q125 60 100 65 Z" fill="#4CAF50" transform="rotate(-5 100 65)" />
      <g fill="#4A148C">
        <circle cx="75" cy="85" r="23" />
        <circle cx="125" cy="85" r="23" />
        <circle cx="58" cy="115" r="23" />
        <circle cx="142" cy="115" r="23" />
        <circle cx="75" cy="145" r="23" />
        <circle cx="125" cy="145" r="23" />
        <circle cx="100" cy="160" r="23" />
      </g>
      <g fill="#7E57C2">
        <circle cx="82" cy="108" r="21" />
        <circle cx="118" cy="108" r="21" />
        <circle cx="100" cy="138" r="21" />
      </g>
      <circle cx="100" cy="100" r="21" fill="#9575CD" />
    </g>
  </svg>
)

// SVG 图标组件
const IconSearch = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
)
const IconAi = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 9a7 7 0 0 1-7 7m7-7h1m-8 7v3m0 0H9m3 0h3" />
    <path d="M5 9a7 7 0 0 0 7 7M5 9H4" />
  </svg>
)
const IconClipboard = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </svg>
)
const IconClock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
)

// 步骤总数
const TOTAL_STEPS = 7

// AI Provider 类型列表
const AI_PROVIDER_TYPES = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'openai-compatible', label: 'OpenAI 兼容' },
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'google', label: 'Google (Gemini)' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'azure-openai', label: 'Azure OpenAI' },
  { id: 'ollama', label: 'Ollama (本地)' }
]

// 功能卡片数据（使用 SVG 图标组件）
const FEATURES = [
  {
    Icon: IconSearch,
    name: '插件搜索',
    desc: '快速搜索和启动已安装的插件功能',
    bg: 'linear-gradient(135deg, #ede9fe, #dbeafe)',
    color: '#7c3aed'
  },
  {
    Icon: IconAi,
    name: 'AI 工具',
    desc: '强大的 AI 工具集，支持多种模型',
    bg: 'linear-gradient(135deg, #fce7f3, #ede9fe)',
    color: '#d946ef'
  },
  {
    Icon: IconClipboard,
    name: '剪贴板监控',
    desc: '智能剪贴板历史管理与自动匹配',
    bg: 'linear-gradient(135deg, #d1fae5, #dbeafe)',
    color: '#059669'
  },
  {
    Icon: IconClock,
    name: '任务调度',
    desc: '定时运行插件任务，自动化工作流',
    bg: 'linear-gradient(135deg, #fef3c7, #fce7f3)',
    color: '#d97706'
  }
]

interface OnboardingState {
  shortcuts: {
    toggleWindow: string
    openSettings: string
  }
  theme: 'light' | 'dark' | 'system'
  aiProvider: {
    type: string
    apiKey: string
    baseURL: string
  }
  storeSource: {
    name: string
    url: string
  }
}

// 快捷键录制 Hook
function useShortcutRecorder(
  onCapture: (accelerator: string) => void
) {
  const [recording, setRecording] = useState<string | null>(null) // 正在录制的 action name
  const [preview, setPreview] = useState<string | null>(null)
  const finishedRef = useRef(false)

  const startRecording = useCallback((action: string) => {
    setRecording(action)
    setPreview(null)
    finishedRef.current = false
    window.mulby.settings.setShortcutRecordingActive(true).catch(() => {})
  }, [])

  const stopRecording = useCallback(() => {
    setRecording(null)
    setPreview(null)
    finishedRef.current = true
    window.mulby.settings.setShortcutRecordingActive(false).catch(() => {})
  }, [])

  useEffect(() => {
    if (!recording) return
    finishedRef.current = false

    const finish = (accelerator?: string) => {
      if (finishedRef.current) return
      finishedRef.current = true
      setRecording(null)
      setPreview(null)
      window.mulby.settings.setShortcutRecordingActive(false).catch(() => {})
      if (accelerator) onCapture(accelerator)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { finish(); return }

      const mainKey = normalizeShortcutKey(e)
      const parts: string[] = []
      if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (mainKey) parts.push(mainKey)
      const accel = parts.join('+')
      setPreview(accel)

      const hasMod = e.metaKey || e.ctrlKey || e.altKey
      if (mainKey && hasMod) finish(accel)
    }

    const offCaptured = window.mulby.settings.onShortcutCaptured((accel) => {
      finish(accel)
    })

    const handleBlur = () => finish()

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleBlur)
      offCaptured()
      if (!finishedRef.current) {
        finishedRef.current = true
        window.mulby.settings.setShortcutRecordingActive(false).catch(() => {})
      }
    }
  }, [recording, onCapture])

  return { recording, preview, startRecording, stopRecording }
}

export default function OnboardingView() {
  const [step, setStep] = useState(0)
  const [prevStep, setPrevStep] = useState(-1)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [state, setState] = useState<OnboardingState>({
    shortcuts: {
      toggleWindow: 'Alt+Space',
      openSettings: 'CommandOrControl+,'
    },
    theme: 'system',
    aiProvider: {
      type: 'openai-compatible',
      apiKey: '',
      baseURL: ''
    },
    storeSource: {
      name: '',
      url: ''
    }
  })

  // 当前录制的 action ref（用于闭包中获取最新值）
  const recordingActionRef = useRef<string | null>(null)

  // 快捷键录制回调
  const handleShortcutCapture = useCallback((accelerator: string) => {
    const action = recordingActionRef.current
    if (!action) return
    setState(prev => {
      const newShortcuts = { ...prev.shortcuts, [action]: accelerator }
      window.mulby.onboarding.updateShortcut(action, accelerator).catch(() => {})
      return { ...prev, shortcuts: newShortcuts }
    })
  }, [])

  const shortcutRecorder = useShortcutRecorder(handleShortcutCapture)
  const { recording, preview, startRecording } = shortcutRecorder

  // 同步 recording state 到 ref
  useEffect(() => {
    recordingActionRef.current = recording
  }, [recording])

  // 初始化：获取当前设置
  useEffect(() => {
    window.mulby.onboarding.getSettings().then((settings: {
      shortcuts: { toggleWindow: string; openSettings: string }
      theme: string
      storeSources: { name: string; url: string }[]
    }) => {
      setState(prev => ({
        ...prev,
        shortcuts: settings.shortcuts || prev.shortcuts,
        theme: (settings.theme as 'light' | 'dark' | 'system') || 'system'
      }))
    }).catch(() => {})
  }, [])

  // 主题变化监听
  useEffect(() => {
    window.mulby.theme.getActual().then(setTheme)
    const cleanup = window.mulby.onThemeChange(setTheme)
    return cleanup
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const goNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      setPrevStep(step)
      setStep(step + 1)
    }
  }, [step])

  const goPrev = useCallback(() => {
    if (step > 0) {
      setPrevStep(step)
      setStep(step - 1)
    }
  }, [step])

  const handleThemeChange = useCallback((mode: 'light' | 'dark' | 'system') => {
    setState(prev => ({ ...prev, theme: mode }))
    window.mulby.onboarding.updateTheme(mode).catch(() => {})
  }, [])

  const handleComplete = useCallback(async () => {
    try {
      if (state.storeSource.url.trim()) {
        await window.mulby.onboarding.updateStoreSources([{
          id: `store-${Date.now()}`,
          name: state.storeSource.name.trim() || '自定义商店',
          url: state.storeSource.url.trim(),
          enabled: true,
          priority: 0
        }])
      }
      if (state.aiProvider.apiKey.trim()) {
        const providerType = AI_PROVIDER_TYPES.find(p => p.id === state.aiProvider.type)
        await window.mulby.onboarding.updateAiProvider({
          id: state.aiProvider.type,
          type: state.aiProvider.type,
          label: providerType?.label || state.aiProvider.type,
          enabled: true,
          apiKey: state.aiProvider.apiKey.trim(),
          baseURL: state.aiProvider.baseURL.trim() || undefined
        })
      }
      // 标记引导完成（主进程会关闭窗口并显示主搜索框）
      await window.mulby.onboarding.complete()
    } catch (error) {
      console.error('[Onboarding] 完成引导失败:', error)
    }
  }, [state])

  const getStepClass = (index: number) => {
    if (index === step) return 'onboarding-step active'
    if (index === prevStep && prevStep < step) return 'onboarding-step exit-left'
    if (index === prevStep && prevStep > step) return 'onboarding-step exit-right'
    return 'onboarding-step'
  }

  // 渲染快捷键录制区块
  const renderShortcutRow = (action: 'toggleWindow' | 'openSettings', label: string) => {
    const isRecording = recording === action
    const displayValue = isRecording
      ? (preview || '按下快捷键…')
      : (state.shortcuts[action] || '未设置')

    return (
      <div className="onboarding-form-group">
        <label className="onboarding-label">{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            className="onboarding-input"
            style={{
              flex: 1,
              cursor: 'default',
              display: 'flex',
              alignItems: 'center',
              minHeight: 38,
              opacity: isRecording ? 0.7 : 1,
              borderColor: isRecording ? '#7c3aed' : undefined,
              boxShadow: isRecording ? '0 0 0 3px rgba(124, 58, 237, 0.15)' : undefined
            }}
          >
            {displayValue}
          </div>
          <button
            className={`onboarding-btn ${isRecording ? 'onboarding-btn-primary' : 'onboarding-btn-secondary'}`}
            style={{ padding: '8px 16px', fontSize: 13, whiteSpace: 'nowrap' }}
            onClick={() => {
              if (isRecording) {
                shortcutRecorder.stopRecording()
              } else {
                startRecording(action)
              }
            }}
          >
            {isRecording ? '取消' : '录制'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`onboarding-window ${theme === 'dark' ? 'dark bg-slate-900' : 'bg-white'}`}>
      {/* 背景粒子 */}
      <div className="onboarding-particles">
        <div className="orb" />
        <div className="orb" />
        <div className="orb" />
      </div>

      <div className="onboarding-content">
        {/* 可跳过步骤的跳过按钮 */}
        {(step === 3 || step === 4) && (
          <button className="onboarding-btn-skip" onClick={goNext}>
            跳过
          </button>
        )}

        <div className="onboarding-step-wrapper">
          {/* 步骤 1: 欢迎 */}
          <div className={getStepClass(0)}>
            <MulbyLogo />
            <div className="onboarding-title">欢迎使用 Mulby</div>
            <div className="onboarding-subtitle">
              一个高效的桌面效率工具，通过插件扩展无限能力。<br />
              让我们花一分钟完成基础配置。
            </div>
          </div>

          {/* 步骤 2: 快捷键（录制模式） */}
          <div className={getStepClass(1)}>
            <div className="onboarding-scroll">
              <div className="onboarding-step-title">全局快捷键</div>
              <div className="onboarding-step-desc">
                设置快捷键以快速唤起 Mulby。你可以稍后在设置中修改。
              </div>

              {renderShortcutRow('toggleWindow', '唤起主窗口')}
              {renderShortcutRow('openSettings', '打开设置')}

              <div className="onboarding-tip">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                </svg>
                <span>点击「录制」后按下你想要的快捷键组合即可完成设置。</span>
              </div>
            </div>
          </div>

          {/* 步骤 3: 主题 */}
          <div className={getStepClass(2)}>
            <div className="onboarding-step-title">选择主题</div>
            <div className="onboarding-step-desc">
              选择你喜欢的界面外观。
            </div>

            <div className="onboarding-theme-grid">
              {([
                { id: 'light' as const, label: '浅色', icon: '☀️' },
                { id: 'dark' as const, label: '深色', icon: '🌙' },
                { id: 'system' as const, label: '跟随系统', icon: '💻' }
              ]).map((item) => (
                <div
                  key={item.id}
                  className={`onboarding-theme-card ${state.theme === item.id ? 'selected' : ''}`}
                  onClick={() => handleThemeChange(item.id)}
                >
                  <div className="onboarding-theme-icon">{item.icon}</div>
                  <div className="onboarding-theme-label">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 步骤 4: 插件商店配置（可跳过） */}
          <div className={getStepClass(3)}>
            <div className="onboarding-scroll">
              <div className="onboarding-step-title">插件商店</div>
              <div className="onboarding-step-desc">
                添加插件商店源以发现和安装各类插件。
              </div>

              <div className="onboarding-form-group">
                <label className="onboarding-label">商店名称</label>
                <input
                  className="onboarding-input"
                  value={state.storeSource.name}
                  onChange={(e) => setState(prev => ({
                    ...prev,
                    storeSource: { ...prev.storeSource, name: e.target.value }
                  }))}
                  placeholder="例如：官方商店"
                />
              </div>

              <div className="onboarding-form-group">
                <label className="onboarding-label">商店源 URL</label>
                <input
                  className="onboarding-input"
                  value={state.storeSource.url}
                  onChange={(e) => setState(prev => ({
                    ...prev,
                    storeSource: { ...prev.storeSource, url: e.target.value }
                  }))}
                  placeholder="https://example.com/store/plugins.json"
                />
              </div>

              <div className="onboarding-tip">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                </svg>
                <span>你也可以稍后在设置 → 插件管理中添加更多商店源。</span>
              </div>
            </div>
          </div>

          {/* 步骤 5: AI 配置（可跳过） */}
          <div className={getStepClass(4)}>
            <div className="onboarding-scroll">
              <div className="onboarding-step-title">AI 服务配置</div>
              <div className="onboarding-step-desc">
                部分插件借助 AI 能力增强功能体验，配置 AI 服务后即可解锁这些能力。
              </div>

              <div className="onboarding-form-group">
                <label className="onboarding-label">Provider 类型</label>
                <select
                  className="onboarding-select"
                  value={state.aiProvider.type}
                  onChange={(e) => setState(prev => ({
                    ...prev,
                    aiProvider: { ...prev.aiProvider, type: e.target.value }
                  }))}
                >
                  {AI_PROVIDER_TYPES.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div className="onboarding-form-group">
                <label className="onboarding-label">API Key</label>
                <input
                  className="onboarding-input"
                  type="password"
                  value={state.aiProvider.apiKey}
                  onChange={(e) => setState(prev => ({
                    ...prev,
                    aiProvider: { ...prev.aiProvider, apiKey: e.target.value }
                  }))}
                  placeholder="sk-..."
                />
              </div>

              <div className="onboarding-form-group">
                <label className="onboarding-label">Base URL（可选）</label>
                <input
                  className="onboarding-input"
                  value={state.aiProvider.baseURL}
                  onChange={(e) => setState(prev => ({
                    ...prev,
                    aiProvider: { ...prev.aiProvider, baseURL: e.target.value }
                  }))}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <div className="onboarding-tip">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                </svg>
                <span>API Key 仅存储在本地，不会上传到任何服务器。你可以在 AI 设置中随时管理。</span>
              </div>
            </div>
          </div>

          {/* 步骤 6: 功能快览（SVG 图标） */}
          <div className={getStepClass(5)}>
            <div className="onboarding-step-title">核心功能</div>
            <div className="onboarding-step-desc">
              Mulby 通过插件系统提供丰富的功能扩展。
            </div>

            <div className="onboarding-feature-grid" key={step === 5 ? 'visible' : 'hidden'}>
              {step === 5 && FEATURES.map((feature, i) => (
                <div className="onboarding-feature-card" key={i}>
                  <div
                    className="onboarding-feature-icon"
                    style={{ background: feature.bg, color: feature.color }}
                  >
                    <feature.Icon />
                  </div>
                  <div className="onboarding-feature-name">{feature.name}</div>
                  <div className="onboarding-feature-desc">{feature.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 步骤 7: 完成 */}
          <div className={getStepClass(6)}>
            {step === 6 && (
              <>
                <div className="onboarding-checkmark">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div className="onboarding-title" style={{ fontSize: 24, marginTop: 20 }}>一切就绪！</div>
                <div className="onboarding-subtitle">
                  你已完成基础配置。现在可以开始探索 Mulby 了。<br />
                  使用 <strong style={{ color: theme === 'dark' ? '#a78bfa' : '#7c3aed' }}>{state.shortcuts.toggleWindow}</strong> 随时唤起主窗口。
                </div>
              </>
            )}
          </div>
        </div>

        {/* 底部导航栏 */}
        <div className="onboarding-nav">
          {/* 上一步按钮 */}
          <div>
            {step > 0 && step < TOTAL_STEPS - 1 && (
              <button className="onboarding-btn onboarding-btn-secondary" onClick={goPrev}>
                ← 上一步
              </button>
            )}
          </div>

          {/* 进度点 */}
          <div className="onboarding-dots">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div key={i} className={`onboarding-dot ${i === step ? 'active' : ''}`} />
            ))}
          </div>

          {/* 下一步/完成按钮 */}
          <div>
            {step === 0 && (
              <button className="onboarding-btn onboarding-btn-primary" onClick={goNext}>
                开始配置 →
              </button>
            )}
            {step > 0 && step < TOTAL_STEPS - 1 && (
              <button className="onboarding-btn onboarding-btn-primary" onClick={goNext}>
                下一步 →
              </button>
            )}
            {step === TOTAL_STEPS - 1 && (
              <button className="onboarding-btn onboarding-btn-primary" onClick={handleComplete}>
                开始使用 Mulby
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
