import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { normalizeShortcutKey } from './settings/utils'
import { getSystemDefaultProviders } from '../../shared/ai/systemProviders'
import { getSystemDefaultModels } from '../../shared/ai/systemModels'
import type { AiProviderConfig } from '../../shared/types/ai'
import type { PluginStoreEntry } from '../../shared/types/plugin-store'
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

// 系统供应商列表和模型列表
const SYSTEM_PROVIDERS = getSystemDefaultProviders()
const SYSTEM_MODELS = getSystemDefaultModels()

// 根据供应商 ID 获取其第一个推荐模型（用于测试连接的默认值）
function getDefaultModelForProvider(providerId: string): string {
  const model = SYSTEM_MODELS.find(m => m.providerRef === providerId)
  return model ? model.label : ''
}

// 根据供应商 ID 查找供应商配置
function findProvider(providerId: string): AiProviderConfig | undefined {
  return SYSTEM_PROVIDERS.find(p => p.id === providerId)
}

// 功能卡片数据
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

// 步骤 ID 枚举（渲染顺序固定）
type StepId = 'welcome' | 'shortcuts' | 'theme' | 'store-source' | 'plugin-install' | 'ai-config' | 'ai-test' | 'features' | 'done'


interface OnboardingState {
  shortcuts: {
    toggleWindow: string
    openSettings: string
  }
  theme: 'light' | 'dark' | 'system'
  // aiProvider.providerId 存储的是系统供应商 id（如 'deepseek', 'silicon'）
  aiProvider: {
    providerId: string
    apiKey: string
    baseURL: string
    model: string
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
  const [recording, setRecording] = useState<string | null>(null)
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
  // 以 stepId 作为主状态追踪当前步骤
  const [currentStepId, setCurrentStepId] = useState<StepId>('welcome')
  const [prevStepId, setPrevStepId] = useState<StepId | null>(null)
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [state, setState] = useState<OnboardingState>({
    shortcuts: {
      toggleWindow: 'Alt+Space',
      openSettings: 'CommandOrControl+,'
    },
    theme: 'system',
    aiProvider: {
      providerId: '',
      apiKey: '',
      baseURL: '',
      model: ''
    },
    storeSource: {
      name: '',
      url: ''
    }
  })

  // 插件商店相关状态
  const [storePlugins, setStorePlugins] = useState<PluginStoreEntry[]>([])
  const [storeLoading, setStoreLoading] = useState(false)
  const [installingPluginKey, setInstallingPluginKey] = useState<string | null>(null)

  // AI 测试相关状态
  const [aiTestState, setAiTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [aiTestMessage, setAiTestMessage] = useState('')

  // 临时保存的商店源 ID（fetch 前需要临时持久化，完成/回退时清理）
  const tempStoreSourceIdRef = useRef<string | null>(null)
  // 现有的商店源快照（初始化时读取，用于合并而非覆盖）
  const existingSourcesRef = useRef<Array<{ id: string; name: string; url: string; enabled: boolean; priority: number }>>([])

  const recordingActionRef = useRef<string | null>(null)

  // ---- 动态步骤序列（用于导航和进度条，不影响渲染） ----
  const activeSteps = useMemo<StepId[]>(() => {
    const steps: StepId[] = ['welcome', 'shortcuts', 'theme', 'store-source']
    if (state.storeSource.url.trim()) {
      steps.push('plugin-install')
    }
    steps.push('ai-config')
    if (state.aiProvider.apiKey.trim()) {
      steps.push('ai-test')
    }
    steps.push('features', 'done')
    return steps
  }, [state.storeSource.url, state.aiProvider.apiKey])

  const currentIndex = activeSteps.indexOf(currentStepId)
  const totalSteps = activeSteps.length
  const isFirstStep = currentIndex === 0
  const isLastStep = currentIndex === totalSteps - 1
  const isSkippableStep = currentStepId === 'store-source' || currentStepId === 'ai-config'
    || currentStepId === 'plugin-install' || currentStepId === 'ai-test'

  // 快捷键录制
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

  useEffect(() => {
    recordingActionRef.current = recording
  }, [recording])

  // 初始化
  useEffect(() => {
    window.mulby.onboarding.getSettings().then((settings: {
      shortcuts: { toggleWindow: string; openSettings: string }
      theme: string
      storeSources: Array<{ id: string; name: string; url: string; enabled: boolean; priority: number }>
    }) => {
      // 保存现有商店源快照，后续合并时使用
      existingSourcesRef.current = settings.storeSources || []
      setState(prev => ({
        ...prev,
        shortcuts: settings.shortcuts || prev.shortcuts,
        theme: (settings.theme as 'light' | 'dark' | 'system') || 'system'
      }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    window.mulby.theme.getActual().then(setTheme)
    const cleanup = window.mulby.onThemeChange(setTheme)
    return cleanup
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // ---- 临时保存商店源（合并到现有源列表，而非覆盖） ----
  const tempSaveStoreSource = useCallback(async () => {
    if (!state.storeSource.url.trim()) return
    const id = tempStoreSourceIdRef.current || `store-${Date.now()}`
    tempStoreSourceIdRef.current = id
    const tempSource = {
      id,
      name: state.storeSource.name.trim() || '自定义商店',
      url: state.storeSource.url.trim(),
      enabled: true,
      priority: 0
    }
    // 合并：保留现有源 + 追加/更新临时源
    const others = existingSourcesRef.current.filter(s => s.id !== id)
    await window.mulby.onboarding.updateStoreSources([...others, tempSource])
  }, [state.storeSource])

  // 清除临时保存的商店源（恢复为原始列表）
  const clearTempStoreSource = useCallback(async () => {
    if (!tempStoreSourceIdRef.current) return
    const others = existingSourcesRef.current.filter(s => s.id !== tempStoreSourceIdRef.current)
    await window.mulby.onboarding.updateStoreSources(others)
    tempStoreSourceIdRef.current = null
  }, [])

  // 加载商店插件
  const loadStorePlugins = useCallback(async () => {
    if (!window.mulby?.pluginStore?.fetch) return
    setStoreLoading(true)
    try {
      const result = await window.mulby.pluginStore.fetch()
      setStorePlugins(result.entries)
    } catch (err) {
      console.error('[Onboarding] 加载商店插件失败:', err)
      // P2: fetch 失败时清空过期数据，避免展示旧商店源的插件
      setStorePlugins([])
    } finally {
      setStoreLoading(false)
    }
  }, [])

  // 安装单个插件
  const installStorePlugin = useCallback(async (entry: PluginStoreEntry) => {
    const key = `${entry.plugin.id}:${entry.plugin.version}`
    setInstallingPluginKey(key)
    try {
      const result = await window.mulby.pluginStore.installFromUrl({
        pluginId: entry.plugin.id,
        version: entry.plugin.version,
        downloadUrl: entry.plugin.downloadUrl,
        sourceId: entry.sourceId,
        sourceName: entry.sourceName,
        sourceUrl: entry.sourceUrl,
        publisher: entry.plugin.publisher,
        homepage: entry.plugin.homepage,
        repository: entry.plugin.repository,
        sha256: entry.plugin.sha256
      })
      if (!result.success) {
        window.mulby.notification.show(result.error || '安装失败', 'error')
      } else {
        const pluginName = entry.plugin.displayName || entry.plugin.name
        if (result.action === 'updated') {
          window.mulby.notification.show(`插件 ${pluginName} 更新成功`, 'success')
        } else if (result.action === 'already-installed') {
          window.mulby.notification.show(`插件 ${pluginName} 已是当前版本`)
        } else {
          window.mulby.notification.show(`插件 ${pluginName} 安装成功`, 'success')
        }
      }
      await loadStorePlugins()
    } catch (err) {
      const message = err instanceof Error ? err.message : '安装失败'
      window.mulby.notification.show(message, 'error')
    } finally {
      setInstallingPluginKey(null)
    }
  }, [loadStorePlugins])

  // 全部安装
  const installAllPlugins = useCallback(async () => {
    const notInstalled = storePlugins.filter(e => e.installState.status === 'not-installed')
    for (const entry of notInstalled) {
      await installStorePlugin(entry)
    }
  }, [storePlugins, installStorePlugin])

  // AI 连接测试（P1: 必须传入 model 参数）
  const handleTestAiConnection = useCallback(async () => {
    const model = state.aiProvider.model.trim()
    if (!model) {
      setAiTestState('error')
      setAiTestMessage('请先填写测试模型名称。')
      return
    }
    setAiTestState('testing')
    setAiTestMessage('正在测试连接...')
    try {
      const provider = findProvider(state.aiProvider.providerId)
      const result = await window.mulby.ai.testConnection({
        model,
        providerId: state.aiProvider.providerId,
        apiKey: state.aiProvider.apiKey.trim(),
        baseURL: state.aiProvider.baseURL.trim() || provider?.baseURL || undefined
      })
      if (result.success) {
        setAiTestState('success')
        setAiTestMessage(result.message || '连接成功！AI 服务配置正确。')
      } else {
        setAiTestState('error')
        setAiTestMessage(result.message || '连接失败，请检查配置是否正确。')
      }
    } catch (err) {
      setAiTestState('error')
      setAiTestMessage(err instanceof Error ? err.message : '连接测试发生错误')
    }
  }, [state.aiProvider])

  // ---- 导航：根据 activeSteps 进行前后移动 ----
  const navigateTo = useCallback((targetId: StepId, dir: 'forward' | 'backward') => {
    setPrevStepId(currentStepId)
    setDirection(dir)
    setCurrentStepId(targetId)
  }, [currentStepId])

  const goNext = useCallback(async () => {
    const idx = activeSteps.indexOf(currentStepId)
    if (idx < 0 || idx >= activeSteps.length - 1) return

    // 离开商店源步骤时临时保存并触发 fetch（fetch 需要持久化的源）
    if (currentStepId === 'store-source' && state.storeSource.url.trim()) {
      try { await tempSaveStoreSource() } catch {}
      loadStorePlugins()
    }

    const nextId = activeSteps[idx + 1]
    if (nextId) navigateTo(nextId, 'forward')
  }, [activeSteps, currentStepId, state.storeSource, tempSaveStoreSource, loadStorePlugins, navigateTo])

  const goPrev = useCallback(() => {
    const idx = activeSteps.indexOf(currentStepId)
    if (idx <= 0) return
    const prevId = activeSteps[idx - 1]
    if (prevId) navigateTo(prevId, 'backward')
  }, [activeSteps, currentStepId, navigateTo])

  const handleThemeChange = useCallback((mode: 'light' | 'dark' | 'system') => {
    setState(prev => ({ ...prev, theme: mode }))
    window.mulby.onboarding.updateTheme(mode).catch(() => {})
  }, [])

  const handleProviderChange = useCallback((providerId: string) => {
    const provider = findProvider(providerId)
    setState(prev => ({
      ...prev,
      aiProvider: {
        ...prev.aiProvider,
        providerId,
        baseURL: provider?.baseURL || '',
        model: getDefaultModelForProvider(providerId)
      }
    }))
  }, [])

  const handleComplete = useCallback(async () => {
    try {
      // 最终持久化：仅以完成时的表单值为准
      if (state.storeSource.url.trim()) {
        const id = tempStoreSourceIdRef.current || `store-${Date.now()}`
        const finalSource = {
          id,
          name: state.storeSource.name.trim() || '自定义商店',
          url: state.storeSource.url.trim(),
          enabled: true,
          priority: 0
        }
        // 合并：保留现有源 + 最终源
        const others = existingSourcesRef.current.filter(s => s.id !== id)
        await window.mulby.onboarding.updateStoreSources([...others, finalSource])
      } else {
        // 用户最终清空了商店源 → 移除临时源，恢复原列表
        await clearTempStoreSource()
      }
      // AI 配置：有 API Key 时必须选择供应商
      if (state.aiProvider.apiKey.trim()) {
        if (!state.aiProvider.providerId) {
          window.mulby.notification.show('请先选择 AI 供应商再完成引导', 'error')
          return
        }
        const provider = findProvider(state.aiProvider.providerId)
        await window.mulby.onboarding.updateAiProvider({
          id: state.aiProvider.providerId,
          type: provider?.type || 'openai-compatible',
          label: provider?.label || state.aiProvider.providerId,
          enabled: true,
          apiKey: state.aiProvider.apiKey.trim(),
          baseURL: state.aiProvider.baseURL.trim() || provider?.baseURL || undefined
        })
      }
      await window.mulby.onboarding.complete()
    } catch (error) {
      console.error('[Onboarding] 完成引导失败:', error)
    }
  }, [state, clearTempStoreSource])

  // ---- 步骤 CSS 动画类 ----
  const getStepClass = (stepId: StepId) => {
    if (stepId === currentStepId) return 'onboarding-step active'
    if (stepId === prevStepId && direction === 'forward') return 'onboarding-step exit-left'
    if (stepId === prevStepId && direction === 'backward') return 'onboarding-step exit-right'
    return 'onboarding-step'
  }

  // 快捷键行渲染
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
              flex: 1, cursor: 'default', display: 'flex', alignItems: 'center', minHeight: 38,
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
              if (isRecording) shortcutRecorder.stopRecording()
              else startRecording(action)
            }}
          >
            {isRecording ? '取消' : '录制'}
          </button>
        </div>
      </div>
    )
  }

  // 插件卡片渲染
  const renderPluginIcon = (entry: PluginStoreEntry) => {
    const pluginName = entry.plugin.displayName || entry.plugin.name
    const initial = pluginName.trim().slice(0, 1).toUpperCase() || '?'
    const icon = entry.plugin.icon

    if (icon?.type === 'emoji' && icon.value) {
      return <div className="onboarding-plugin-icon">{icon.value}</div>
    }

    if (icon?.type === 'url' && icon.value) {
      return (
        <div className="onboarding-plugin-icon onboarding-plugin-icon-img">
          <img
            src={icon.value}
            alt={pluginName}
            onError={(e) => {
              // 图片加载失败，替换为首字母
              const parent = (e.target as HTMLImageElement).parentElement
              if (parent) {
                parent.classList.remove('onboarding-plugin-icon-img')
                parent.textContent = initial
              }
            }}
          />
        </div>
      )
    }

    return <div className="onboarding-plugin-icon">{initial}</div>
  }

  const renderPluginCard = (entry: PluginStoreEntry) => {
    const key = `${entry.plugin.id}:${entry.plugin.version}`
    const pluginName = entry.plugin.displayName || entry.plugin.name
    const isInstalled = entry.installState.status === 'installed'
    const isInstalling = installingPluginKey === key

    return (
      <div key={key} className="onboarding-plugin-card">
        {renderPluginIcon(entry)}
        <div className="onboarding-plugin-info">
          <div className="onboarding-plugin-name">{pluginName}</div>
          <div className="onboarding-plugin-desc">{entry.plugin.description}</div>
        </div>
        <button
          className={`onboarding-plugin-action ${isInstalled ? 'installed' : ''}`}
          disabled={isInstalled || isInstalling}
          onClick={() => void installStorePlugin(entry)}
          title={isInstalling ? '安装中' : isInstalled ? '已安装' : '安装'}
        >
          {isInstalling ? (
            <div className="onboarding-spinner-small" />
          ) : isInstalled ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
        </button>
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
        {isSkippableStep && (
          <button className="onboarding-btn-skip" onClick={goNext}>
            跳过
          </button>
        )}

        <div className="onboarding-step-wrapper">
          {/* 欢迎 */}
          <div className={getStepClass('welcome')}>
            <MulbyLogo />
            <div className="onboarding-title">欢迎使用 Mulby</div>
            <div className="onboarding-subtitle">
              一个高效的桌面效率工具，通过插件扩展无限能力。<br />
              让我们花一分钟完成基础配置。
            </div>
          </div>

          {/* 快捷键 */}
          <div className={getStepClass('shortcuts')}>
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

          {/* 主题 */}
          <div className={getStepClass('theme')}>
            <div className="onboarding-step-title">选择主题</div>
            <div className="onboarding-step-desc">选择你喜欢的界面外观。</div>
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

          {/* 插件商店配置 */}
          <div className={getStepClass('store-source')}>
            <div className="onboarding-scroll">
              <div className="onboarding-step-title">插件商店</div>
              <div className="onboarding-step-desc">添加插件商店源以发现和安装各类插件。</div>
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

          {/* 插件选装（条件步骤） */}
          <div className={getStepClass('plugin-install')}>
            <div className="onboarding-scroll">
              <div className="onboarding-step-title">选择安装插件</div>
              <div className="onboarding-step-desc">从商店中浏览并安装你需要的插件。</div>

              {storeLoading ? (
                <div className="onboarding-plugin-loading">
                  <div className="onboarding-spinner" />
                  <span>正在加载插件列表...</span>
                </div>
              ) : storePlugins.length === 0 ? (
                <div className="onboarding-plugin-empty">暂无可安装插件。</div>
              ) : (
                <>
                  <div className="onboarding-plugin-toolbar">
                    <span style={{ fontSize: 13, color: '#64748b' }}>
                      共 {storePlugins.length} 个插件
                    </span>
                    <button
                      className="onboarding-btn onboarding-btn-secondary"
                      style={{ padding: '6px 14px', fontSize: 12 }}
                      onClick={() => void installAllPlugins()}
                      disabled={!!installingPluginKey || storePlugins.every(e => e.installState.status === 'installed')}
                    >
                      全部安装
                    </button>
                  </div>
                  <div className="onboarding-plugin-list">
                    {storePlugins.map(renderPluginCard)}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* AI 配置 */}
          <div className={getStepClass('ai-config')}>
            <div className="onboarding-scroll">
              <div className="onboarding-step-title">AI 服务配置</div>
              <div className="onboarding-step-desc">
                部分插件借助 AI 能力增强功能体验，配置 AI 服务后即可解锁这些能力。
              </div>
              <div className="onboarding-form-group">
                <label className="onboarding-label">AI 供应商</label>
                <select
                  className="onboarding-select"
                  value={state.aiProvider.providerId}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  <option value="">请选择供应商...</option>
                  {SYSTEM_PROVIDERS.map(p => (
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
                  placeholder={
                    findProvider(state.aiProvider.providerId)?.baseURL
                    || 'https://api.openai.com/v1'
                  }
                />
              </div>
              <div className="onboarding-form-group">
                <label className="onboarding-label">测试模型（用于验证连接）</label>
                <input
                  className="onboarding-input"
                  value={state.aiProvider.model}
                  onChange={(e) => setState(prev => ({
                    ...prev,
                    aiProvider: { ...prev.aiProvider, model: e.target.value }
                  }))}
                  placeholder={
                    getDefaultModelForProvider(state.aiProvider.providerId) || '例如：gpt-4o-mini'
                  }
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

          {/* AI 连接测试（条件步骤） */}
          <div className={getStepClass('ai-test')}>
            <div className="onboarding-scroll">
              <div className="onboarding-step-title">测试 AI 连接</div>
              <div className="onboarding-step-desc">
                验证你的 AI 服务配置是否正确，确保连接畅通。
              </div>

              <div className="onboarding-test-container">
                <div className="onboarding-test-provider-info">
                  <div className="onboarding-test-provider-label">
                    {findProvider(state.aiProvider.providerId)?.label || state.aiProvider.providerId || '未选择'}
                  </div>
                  <div className="onboarding-test-provider-url">
                    {state.aiProvider.baseURL || findProvider(state.aiProvider.providerId)?.baseURL || '默认地址'}
                  </div>
                </div>

                <button
                  className="onboarding-btn onboarding-btn-primary"
                  style={{ padding: '10px 28px', fontSize: 14 }}
                  onClick={() => void handleTestAiConnection()}
                  disabled={aiTestState === 'testing'}
                >
                  {aiTestState === 'testing' ? (
                    <>
                      <div className="onboarding-spinner-small" />
                      测试中...
                    </>
                  ) : '测试连接'}
                </button>

                {aiTestState !== 'idle' && aiTestState !== 'testing' && (
                  <div className={`onboarding-test-result ${aiTestState === 'success' ? 'success' : 'error'}`}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                      {aiTestState === 'success' ? (
                        <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>
                      ) : (
                        <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></>
                      )}
                    </svg>
                    <span>{aiTestMessage}</span>
                  </div>
                )}
              </div>

              <div className="onboarding-tip" style={{ marginTop: 20 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                </svg>
                <span>测试将向 AI 服务发送一条简单请求以验证连接性。即使测试失败也可继续使用。</span>
              </div>
            </div>
          </div>

          {/* 功能快览 */}
          <div className={getStepClass('features')}>
            <div className="onboarding-step-title">核心功能</div>
            <div className="onboarding-step-desc">Mulby 通过插件系统提供丰富的功能扩展。</div>
            <div className="onboarding-feature-grid" key={currentStepId === 'features' ? 'visible' : 'hidden'}>
              {currentStepId === 'features' && FEATURES.map((feature, i) => (
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

          {/* 完成 */}
          <div className={getStepClass('done')}>
            {currentStepId === 'done' && (
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
          <div>
            {!isFirstStep && !isLastStep && (
              <button className="onboarding-btn onboarding-btn-secondary" onClick={goPrev}>
                ← 上一步
              </button>
            )}
          </div>

          {/* 进度点（动态数量） */}
          <div className="onboarding-dots">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className={`onboarding-dot ${i === currentIndex ? 'active' : ''}`} />
            ))}
          </div>

          <div>
            {isFirstStep && (
              <button className="onboarding-btn onboarding-btn-primary" onClick={goNext}>
                开始配置 →
              </button>
            )}
            {!isFirstStep && !isLastStep && (
              <button className="onboarding-btn onboarding-btn-primary" onClick={goNext}>
                下一步 →
              </button>
            )}
            {isLastStep && (
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
