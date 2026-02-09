import { useEffect, useState } from 'react'
import { Check, Copy, Loader2, RefreshCcw, Settings2 } from 'lucide-react'
import { useIntools } from './hooks/useIntools'

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
}

interface AiModelOption {
  id: string
  label: string
  providerLabel?: string
}

interface TranslatorSettings {
  modelId: string
  defaultTargetLanguage: string
}

type Tab = 'translate' | 'settings'

interface LanguageOption {
  code: string
  label: string
}

const SETTINGS_STORAGE_KEY = 'translator.settings.v1'
const DEFAULT_TARGET_LANGUAGE = 'zh-CN'
const TARGET_LANGUAGES: LanguageOption[] = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'ru', label: '俄语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'ar', label: '阿拉伯语' }
]
const SOURCE_LANGUAGES: LanguageOption[] = [
  { code: 'auto', label: '自动检测' },
  ...TARGET_LANGUAGES
]

const TARGET_LANGUAGE_CODES = new Set(TARGET_LANGUAGES.map((item) => item.code))

function getLanguageLabel(code: string, options: LanguageOption[]) {
  return options.find((item) => item.code === code)?.label || code
}

function extractResponseText(content?: string | Array<{ type?: string; text?: string }>) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

function normalizeSettings(raw: unknown): TranslatorSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      modelId: '',
      defaultTargetLanguage: DEFAULT_TARGET_LANGUAGE
    }
  }

  const value = raw as { modelId?: unknown; defaultTargetLanguage?: unknown }
  const modelId = typeof value.modelId === 'string' ? value.modelId : ''
  const defaultTargetLanguage =
    typeof value.defaultTargetLanguage === 'string' && TARGET_LANGUAGE_CODES.has(value.defaultTargetLanguage)
      ? value.defaultTargetLanguage
      : DEFAULT_TARGET_LANGUAGE

  return { modelId, defaultTargetLanguage }
}

function buildTranslationSystemPrompt(sourceLanguage: string, targetLanguage: string) {
  return [
    '你是一个专业、可靠的翻译引擎。',
    `源语言要求：${sourceLanguage}。`,
    `目标语言要求：${targetLanguage}。`,
    '翻译规则：',
    '1. 准确保留原文语义、语气和上下文。',
    '2. 保留原文结构（段落、换行、列表、代码块、标点风格）。',
    '3. 专有名词、产品名、变量名、代码标识符优先保持原样，必要时仅翻译其解释性文本。',
    '4. 如果源语言已是目标语言，请输出润色后的自然表达。',
    '输出要求：',
    '1. 只输出最终译文，不要解释，不要附加前后缀。',
    '2. 不要包含“翻译结果：”等提示语。',
    '3. 输入为空时输出空字符串。'
  ].join('\n')
}

export default function App() {
  const { ai, clipboard, notification, storage } = useIntools('ai-translator')
  const [, setTheme] = useState<'light' | 'dark'>('light')
  const [activeTab, setActiveTab] = useState<Tab>('translate')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_TARGET_LANGUAGE)
  const [settingsTargetLanguage, setSettingsTargetLanguage] = useState(DEFAULT_TARGET_LANGUAGE)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [models, setModels] = useState<AiModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)

  const loadModels = async (preferredModelId?: string) => {
    try {
      setLoadingModels(true)
      const list = await ai.allModels()
      const normalized = Array.isArray(list)
        ? list
          .filter((item) => item?.id)
          .map((item) => ({
            id: item.id,
            label: item.label || item.id,
            providerLabel: item.providerLabel
          }))
        : []

      setModels(normalized)
      setSelectedModelId((current) => {
        if (current && normalized.some((item) => item.id === current)) return current
        if (preferredModelId && normalized.some((item) => item.id === preferredModelId)) return preferredModelId
        return normalized[0]?.id || ''
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '加载模型失败'
      notification.show(message, 'error')
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    // 获取初始主题（从 URL 参数）
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    // 监听主题变化
    window.intools?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据
    window.intools?.onPluginInit?.((data: PluginInitData) => {
      if (data.input) {
        setInput(data.input)
      }
      if (data.featureCode === 'settings' || data.route?.includes('settings')) {
        setActiveTab('settings')
      }
    })

    const tabParams = new URLSearchParams(window.location.search)
    if (tabParams.get('tab') === 'settings') {
      setActiveTab('settings')
    }

    void (async () => {
      const saved = normalizeSettings(await storage.get(SETTINGS_STORAGE_KEY))
      setSettingsTargetLanguage(saved.defaultTargetLanguage)
      setTargetLanguage(saved.defaultTargetLanguage)
      setSelectedModelId(saved.modelId)
      await loadModels(saved.modelId)
    })()
  }, [])

  const handleTranslate = async () => {
    const text = input.trim()
    if (!text) {
      notification.show('请先输入需要翻译的文本', 'warning')
      return
    }

    try {
      setIsTranslating(true)
      const sourceLabel = getLanguageLabel(sourceLanguage, SOURCE_LANGUAGES)
      const targetLabel = getLanguageLabel(targetLanguage, TARGET_LANGUAGES)
      const response = await ai.call({
        model: selectedModelId || undefined,
        messages: [
          {
            role: 'system',
            content: buildTranslationSystemPrompt(sourceLabel, targetLabel)
          },
          {
            role: 'user',
            content: text
          }
        ],
        params: {
          temperature: 0.1
        }
      })

      const translated = extractResponseText(response?.content).trim()
      if (!translated) {
        notification.show('AI 未返回可用译文', 'warning')
        return
      }

      setOutput(translated)
      notification.show('翻译完成', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '翻译失败'
      notification.show(message, 'error')
    } finally {
      setIsTranslating(false)
    }
  }

  const handleCopyOutput = async () => {
    if (!output.trim()) {
      notification.show('没有可复制的译文', 'warning')
      return
    }
    await clipboard.writeText(output)
    notification.show('译文已复制到剪贴板', 'success')
  }

  const handleSaveSettings = async () => {
    if (!TARGET_LANGUAGE_CODES.has(settingsTargetLanguage)) {
      notification.show('默认目标语言无效', 'error')
      return
    }

    const settings: TranslatorSettings = {
      modelId: selectedModelId,
      defaultTargetLanguage: settingsTargetLanguage
    }

    try {
      setIsSavingSettings(true)
      await storage.set(SETTINGS_STORAGE_KEY, settings)
      setTargetLanguage(settingsTargetLanguage)
      notification.show('设置已保存', 'success')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '设置保存失败'
      notification.show(message, 'error')
    } finally {
      setIsSavingSettings(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="title-wrap">
          <h1>AI 翻译</h1>
          <p>使用系统内置 AI 进行高质量翻译</p>
        </div>
        <div className="tab-group">
          <button
            className={`tab-btn ${activeTab === 'translate' ? 'active' : ''}`}
            onClick={() => setActiveTab('translate')}
          >
            翻译
          </button>
          <button
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings2 size={14} />
            设置
          </button>
        </div>
      </header>
      <div className="container">
        {activeTab === 'translate' ? (
          <>
            <section className="selectors">
              <div className="field">
                <label>源语言</label>
                <select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>
                  {SOURCE_LANGUAGES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>目标语言</label>
                <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
                  {TARGET_LANGUAGES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field compact">
                <label>当前模型</label>
                <div className="model-chip">{selectedModelId || '系统默认'}</div>
              </div>
            </section>
            <div className="field">
              <label>原文</label>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="请输入需要翻译的文本"
              />
            </div>
            <div className="actions">
              <button className="btn-primary" onClick={handleTranslate} disabled={isTranslating}>
                {isTranslating ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    翻译中...
                  </>
                ) : (
                  '开始翻译'
                )}
              </button>
              <button className="btn-secondary" onClick={() => setTargetLanguage(settingsTargetLanguage)}>
                使用默认目标语言
              </button>
              <button className="btn-secondary" onClick={handleCopyOutput}>
                <Copy size={14} />
                复制译文
              </button>
            </div>
            <div className="field">
              <label>译文</label>
              <textarea value={output} readOnly placeholder="翻译结果将显示在这里" />
            </div>
          </>
        ) : (
          <section className="settings-panel">
            <div className="field">
              <label>翻译模型</label>
              <div className="inline-row">
                <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>
                  <option value="">跟随系统默认模型</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.providerLabel ? `${model.providerLabel} / ${model.label}` : model.label}
                    </option>
                  ))}
                </select>
                <button className="btn-secondary" onClick={() => void loadModels(selectedModelId)} disabled={loadingModels}>
                  {loadingModels ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />}
                  刷新模型
                </button>
              </div>
            </div>
            <div className="field">
              <label>默认目标语言</label>
              <select value={settingsTargetLanguage} onChange={(event) => setSettingsTargetLanguage(event.target.value)}>
                {TARGET_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-tips">
              <Check size={14} />
              <span>保存后会作为翻译页的默认目标语言。</span>
            </div>
            <div className="actions">
              <button className="btn-primary" onClick={handleSaveSettings} disabled={isSavingSettings}>
                {isSavingSettings ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    保存中...
                  </>
                ) : (
                  '保存设置'
                )}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
