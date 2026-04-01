import { useCallback, useEffect, useState } from 'react'
import type { AiToolWebSearchSettings, CustomSearchApiConfig } from '../../../shared/types/settings'
import UnifiedSelect from '../UnifiedSelect'
import { classNames } from './shared'

/** 内置 API Provider 选项 */
const BUILTIN_API_PROVIDERS = [
  { id: 'tavily', label: 'Tavily（推荐）', keyPlaceholder: 'tvly-...' },
  { id: 'jina', label: 'Jina AI', keyPlaceholder: 's_...' }
] as const

/** Provider 是否为本地引擎类型 */
function isLocalProvider(id: string) {
  return id.startsWith('local-')
}

/** Provider 是否为内置 API */
function isBuiltinApiProvider(id: string) {
  return BUILTIN_API_PROVIDERS.some((p) => p.id === id)
}

interface AiToolSettingsModalProps {
  show: boolean
  onClose: () => void
}

export default function AiToolSettingsModal({ show, onClose }: AiToolSettingsModalProps) {
  const [settings, setSettings] = useState<AiToolWebSearchSettings | null>(null)
  const [loading, setLoading] = useState(true)

  // 自定义 API 编辑态
  const [showAddCustomApi, setShowAddCustomApi] = useState(false)
  const [editingCustomApi, setEditingCustomApi] = useState<Partial<CustomSearchApiConfig>>({})

  // 加载设置
  useEffect(() => {
    if (!show) return
    setLoading(true)
    window.mulby?.ai?.tooling?.webSearch?.get?.()
      .then((data) => {
        setSettings(data as unknown as AiToolWebSearchSettings)
      })
      .catch((err) => {
        console.error('加载 Web Search 设置失败:', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [show])

  // 保存设置
  const saveSettings = useCallback(async (patch: Partial<AiToolWebSearchSettings>) => {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      const result = await window.mulby?.ai?.tooling?.webSearch?.update?.(patch as unknown as Record<string, unknown>)
      if (result) {
        setSettings(result as unknown as AiToolWebSearchSettings)
      }
    } catch (err) {
      console.error('保存 Web Search 设置失败:', err)
    }
  }, [settings])

  if (!show) return null

  // 构建 Provider 选项列表
  const providerOptions: Array<{ id: string; label: string; group: string }> = []

  // 本地引擎
  if (settings?.localEngines) {
    for (const engine of settings.localEngines) {
      providerOptions.push({
        id: engine.id,
        label: `${engine.name}（本地）`,
        group: '本地搜索（免费）'
      })
    }
  }
  // 确保至少有 local-bing
  if (!providerOptions.some((p) => p.id === 'local-bing')) {
    providerOptions.unshift({ id: 'local-bing', label: 'Bing（本地）', group: '本地搜索（免费）' })
  }

  // 内置 API
  for (const api of BUILTIN_API_PROVIDERS) {
    providerOptions.push({ id: api.id, label: api.label, group: 'API Provider' })
  }

  // 自定义 API
  if (settings?.customApis) {
    for (const api of settings.customApis) {
      providerOptions.push({ id: `custom-${api.id}`, label: api.name, group: '自定义 API' })
    }
  }

  const activeProvider = settings?.activeProvider || 'local-bing'
  const activeBuiltinApi = BUILTIN_API_PROVIDERS.find((p) => p.id === activeProvider)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900 no-drag"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">工具设置</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              配置 Web Search 搜索引擎和 API 密钥
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 no-drag"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">加载中…</div>
        ) : !settings ? (
          <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">加载失败，请重试</div>
        ) : (
          <div className="space-y-5">
            {/* ---- 搜索引擎选择 ---- */}
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">搜索引擎</div>
              <UnifiedSelect
                value={activeProvider}
                onChange={(e) => saveSettings({ activeProvider: e.target.value })}
              >
                {/* 按分组显示 */}
                {Array.from(new Set(providerOptions.map((p) => p.group))).map((group) => (
                  <optgroup key={group} label={group}>
                    {providerOptions.filter((p) => p.group === group).map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </optgroup>
                ))}
              </UnifiedSelect>

              {/* 本地引擎提示 */}
              {isLocalProvider(activeProvider) && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200">
                  ✓ 使用浏览器爬取搜索引擎结果，无需 API Key，免费使用
                </div>
              )}
            </div>

            {/* ---- 内置 API Key 配置 ---- */}
            {isBuiltinApiProvider(activeProvider) && activeBuiltinApi && (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">
                  {activeBuiltinApi.label} API Key
                </div>
                <input
                  className={classNames.inputClass}
                  type="password"
                  placeholder={activeBuiltinApi.keyPlaceholder}
                  value={settings.providerKeys?.[activeProvider as 'tavily' | 'jina'] || ''}
                  onChange={(e) => {
                    const key = activeProvider as 'tavily' | 'jina'
                    saveSettings({
                      providerKeys: {
                        ...settings.providerKeys,
                        [key]: e.target.value
                      }
                    })
                  }}
                />
                {activeProvider === 'tavily' && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    前往{' '}
                    <a
                      href="https://app.tavily.com/home"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline dark:text-blue-400"
                    >
                      app.tavily.com
                    </a>
                    {' '}获取免费 API Key（每月 1000 次搜索）
                  </div>
                )}
                {activeProvider === 'jina' && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    前往{' '}
                    <a
                      href="https://jina.ai/api-dashboard/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline dark:text-blue-400"
                    >
                      jina.ai
                    </a>
                    {' '}获取 API Key
                  </div>
                )}
              </div>
            )}

            {/* ---- 各 Provider 独立 Key 管理 ---- */}
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">所有 API 密钥</div>
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-800/80 dark:bg-slate-900/50">
                {BUILTIN_API_PROVIDERS.map((api) => {
                  const hasKey = !!settings.providerKeys?.[api.id]
                  return (
                    <div key={api.id} className="flex items-center justify-between py-1.5">
                      <span className="text-sm text-slate-700 dark:text-slate-200">{api.label}</span>
                      <span className={`text-xs ${hasKey ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-400 dark:text-slate-500'}`}>
                        {hasKey ? '✓ 已配置' : '未配置'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ---- Tavily 自定义 Host ---- */}
            {activeProvider === 'tavily' && (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">
                  Tavily API Host（可选）
                </div>
                <input
                  className={classNames.inputClass}
                  placeholder="https://api.tavily.com（默认）"
                  value={settings.tavilyApiHost || ''}
                  onChange={(e) => saveSettings({ tavilyApiHost: e.target.value || undefined })}
                />
              </div>
            )}

            {/* ---- 搜索参数 ---- */}
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">搜索参数</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">最大结果数</label>
                  <input
                    className={classNames.inputClass}
                    type="number"
                    min={1}
                    max={20}
                    value={settings.maxResults}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(20, parseInt(e.target.value) || 5))
                      saveSettings({ maxResults: v })
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">内容截断长度</label>
                  <input
                    className={classNames.inputClass}
                    type="number"
                    min={1000}
                    max={50000}
                    step={1000}
                    value={settings.maxContentLength}
                    onChange={(e) => {
                      const v = Math.max(1000, Math.min(50000, parseInt(e.target.value) || 8000))
                      saveSettings({ maxContentLength: v })
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">超时（秒）</label>
                  <input
                    className={classNames.inputClass}
                    type="number"
                    min={5}
                    max={120}
                    value={Math.round(settings.timeoutMs / 1000)}
                    onChange={(e) => {
                      const v = Math.max(5, Math.min(120, parseInt(e.target.value) || 30))
                      saveSettings({ timeoutMs: v * 1000 })
                    }}
                  />
                </div>
              </div>
            </div>

            {/* ---- 自定义 API ---- */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">自定义搜索 API</div>
                <button
                  className={classNames.pillClass}
                  onClick={() => {
                    setEditingCustomApi({
                      id: `api-${Date.now()}`,
                      name: '',
                      apiHost: '',
                      method: 'POST',
                      resultsPath: 'results',
                      titleField: 'title',
                      urlField: 'url',
                      contentField: 'content'
                    })
                    setShowAddCustomApi(true)
                  }}
                >
                  + 添加 API
                </button>
              </div>

              {(settings.customApis || []).length === 0 && !showAddCustomApi ? (
                <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50 px-4 py-4 text-center text-xs text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
                  暂无自定义 API，点击「添加 API」接入第三方搜索服务
                </div>
              ) : (
                <div className="space-y-2">
                  {(settings.customApis || []).map((api) => (
                    <div
                      key={api.id}
                      className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-900/50"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{api.name}</div>
                        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{api.apiHost}</div>
                      </div>
                      <button
                        className={classNames.actionButtonClass}
                        onClick={() => {
                          const filtered = (settings.customApis || []).filter((a) => a.id !== api.id)
                          // 如果正在使用该 API，切回本地搜索
                          const patch: Partial<AiToolWebSearchSettings> = { customApis: filtered }
                          if (activeProvider === `custom-${api.id}`) {
                            patch.activeProvider = 'local-bing'
                          }
                          saveSettings(patch)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 添加自定义 API 表单 */}
              {showAddCustomApi && (
                <div className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-950">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      className={classNames.inputClass}
                      placeholder="显示名称"
                      value={editingCustomApi.name || ''}
                      onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, name: e.target.value }))}
                    />
                    <input
                      className={classNames.inputClass}
                      placeholder="API Base URL"
                      value={editingCustomApi.apiHost || ''}
                      onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, apiHost: e.target.value }))}
                    />
                    <input
                      className={classNames.inputClass}
                      placeholder="API Key（可选）"
                      type="password"
                      value={editingCustomApi.apiKey || ''}
                      onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, apiKey: e.target.value }))}
                    />
                    <UnifiedSelect
                      value={editingCustomApi.method || 'POST'}
                      onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, method: e.target.value as 'GET' | 'POST' }))}
                    >
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </UnifiedSelect>
                    <input
                      className={classNames.inputClass}
                      placeholder="响应结果路径（如 results）"
                      value={editingCustomApi.resultsPath || ''}
                      onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, resultsPath: e.target.value }))}
                    />
                    {editingCustomApi.method === 'GET' && (
                      <input
                        className={classNames.inputClass}
                        placeholder="查询参数名（如 q）"
                        value={editingCustomApi.queryParam || ''}
                        onChange={(e) => setEditingCustomApi((prev) => ({ ...prev, queryParam: e.target.value }))}
                      />
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      className={classNames.pillClass}
                      onClick={() => {
                        setShowAddCustomApi(false)
                        setEditingCustomApi({})
                      }}
                    >
                      取消
                    </button>
                    <button
                      className={classNames.primaryPillClass}
                      disabled={!editingCustomApi.name?.trim() || !editingCustomApi.apiHost?.trim()}
                      onClick={() => {
                        const api = editingCustomApi as CustomSearchApiConfig
                        const existing = settings.customApis || []
                        saveSettings({ customApis: [...existing, api] })
                        setShowAddCustomApi(false)
                        setEditingCustomApi({})
                      }}
                    >
                      保存
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
