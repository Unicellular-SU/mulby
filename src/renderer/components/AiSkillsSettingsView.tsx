import { useEffect, useMemo, useState } from 'react'
import type { DragEventHandler, MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AiSkillCreateModelOption, AiSkillRecord } from '../../shared/types/ai'

interface AiSkillsSettingsViewProps {
  onBack: () => void
}

interface ParsedSkillMarkdown {
  frontmatter: Record<string, string | string[]>
  body: string
}

function parseSkillMarkdown(input: string): ParsedSkillMarkdown {
  const content = String(input || '')
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?([\s\S]*)$/)
  if (!match) {
    return {
      frontmatter: {},
      body: content
    }
  }

  const frontmatterRaw = match[1]
  const body = match[2] || ''
  const out: Record<string, string | string[]> = {}
  const lines = frontmatterRaw.split(/\r?\n/)
  let currentArrayKey: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const arrayItem = line.match(/^-+\s*(.+)$/)
    if (arrayItem && currentArrayKey) {
      const prev = out[currentArrayKey]
      if (Array.isArray(prev)) {
        prev.push(arrayItem[1].trim())
      } else {
        out[currentArrayKey] = [arrayItem[1].trim()]
      }
      continue
    }

    const keyValue = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!keyValue) {
      currentArrayKey = null
      continue
    }
    const key = keyValue[1]
    const value = keyValue[2].trim()
    if (!value) {
      out[key] = []
      currentArrayKey = key
      continue
    }
    out[key] = value
    currentArrayKey = null
  }

  return {
    frontmatter: out,
    body
  }
}

function frontmatterValueToText(value: string | string[] | undefined): string {
  if (!value) return ''
  if (Array.isArray(value)) return value.join(', ')
  return value
}

export default function AiSkillsSettingsView({ onBack }: AiSkillsSettingsViewProps) {
  const [skills, setSkills] = useState<AiSkillRecord[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [selectedSkillContent, setSelectedSkillContent] = useState('')
  const [createModels, setCreateModels] = useState<AiSkillCreateModelOption[]>([])
  const [selectedCreateModel, setSelectedCreateModel] = useState('')
  const [createRequirements, setCreateRequirements] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draggingZip, setDraggingZip] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showZipModal, setShowZipModal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50'
  const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60'
  const secondaryPillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

  const selectedSkill = useMemo(
    () => (selectedSkillId ? skills.find((item) => item.id === selectedSkillId) || null : null),
    [selectedSkillId, skills]
  )
  const parsedSkillMarkdown = useMemo(() => parseSkillMarkdown(selectedSkillContent), [selectedSkillContent])

  const loadSkills = async (forceRefresh = false) => {
    if (!window.intools?.ai?.skills?.list) {
      setError('Skills API 未就绪，请重启应用')
      return
    }
    setLoading(true)
    try {
      const list = forceRefresh && window.intools.ai.skills.refresh
        ? await window.intools.ai.skills.refresh()
        : await window.intools.ai.skills.list()
      setSkills(list)
      const models = window.intools.ai.skills.listCreateModels
        ? await window.intools.ai.skills.listCreateModels()
        : []
      setCreateModels(models)
      if (!selectedCreateModel && models.length > 0) {
        setSelectedCreateModel(models[0].id)
      } else if (selectedCreateModel && !models.some((model) => model.id === selectedCreateModel)) {
        setSelectedCreateModel(models[0]?.id || '')
      }

      if (list.length === 0) {
        setSelectedSkillId(null)
      } else if (!selectedSkillId || !list.some((item) => item.id === selectedSkillId)) {
        setSelectedSkillId(list[0].id)
      }
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`加载 skills 失败：${message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSkills(true)
  }, [])

  useEffect(() => {
    const loadSkillContent = async () => {
      if (!selectedSkill) {
        setSelectedSkillContent('')
        return
      }

      const filePath = selectedSkill.skillMdPath
      if (filePath && (window.intools as any)?.filesystem?.readFile) {
        try {
          const content = await (window.intools as any).filesystem.readFile(filePath, 'utf-8')
          setSelectedSkillContent(typeof content === 'string' ? content : String(content || ''))
          return
        } catch {
          // fallback to prompt template preview
        }
      }
      setSelectedSkillContent(selectedSkill.descriptor.promptTemplate || '')
    }

    void loadSkillContent()
  }, [selectedSkill])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => {
      setError(null)
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [error])

  useEffect(() => {
    if (!info) return
    const timer = window.setTimeout(() => {
      setInfo(null)
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [info])

  const handleToggleEnabled = async () => {
    if (!selectedSkill || !window.intools?.ai?.skills) return
    setBusy(true)
    try {
      if (selectedSkill.enabled) {
        await window.intools.ai.skills.disable(selectedSkill.id)
      } else {
        await window.intools.ai.skills.enable(selectedSkill.id)
      }
      await loadSkills(true)
      setInfo(selectedSkill.enabled ? 'Skill 已停用' : 'Skill 已启用')
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`状态切换失败：${message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteSkill = async () => {
    if (!selectedSkill || selectedSkill.readonly || selectedSkill.origin === 'system' || !window.intools?.ai?.skills?.remove) return
    const ok = window.confirm(`确认删除 Skill「${selectedSkill.descriptor.name || selectedSkill.id}」吗？`)
    if (!ok) return
    setBusy(true)
    try {
      await window.intools.ai.skills.remove(selectedSkill.id)
      await loadSkills(true)
      setInfo('Skill 已删除')
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`删除失败：${message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleCreateWithAi = async () => {
    if (!window.intools?.ai?.skills?.createWithAi) {
      setError('当前版本不支持 AI 创建 Skill')
      return
    }
    const requirements = createRequirements.trim()
    if (!requirements) {
      setError('请先输入 Skill 需求')
      return
    }
    if (!selectedCreateModel) {
      setError('请选择用于创建 Skill 的模型')
      return
    }
    setBusy(true)
    try {
      const result = await window.intools.ai.skills.createWithAi({
        requirements,
        model: selectedCreateModel,
        enabled: false,
        trustLevel: 'reviewed',
        modePreference: 'both'
      })
      await loadSkills(true)
      if (result?.record?.id) {
        setSelectedSkillId(result.record.id)
      }
      setInfo(`AI 已创建 Skill：${result.record.descriptor.name || result.record.id}`)
      setError(null)
      setCreateRequirements('')
      setShowCreateModal(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`AI 创建失败：${message}`)
    } finally {
      setBusy(false)
    }
  }

  const installZipPath = async (zipPath: string) => {
    if (!window.intools?.ai?.skills?.install) {
      setError('Skills 安装 API 未就绪')
      return
    }
    setBusy(true)
    try {
      const installed = await window.intools.ai.skills.install({
        source: 'zip',
        ref: zipPath
      })
      await loadSkills(true)
      setInfo(`安装完成，共 ${installed.length} 个 skill`)
      setError(null)
      if (installed[0]?.id) {
        setSelectedSkillId(installed[0].id)
      }
      setShowZipModal(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`ZIP 安装失败：${message}`)
    } finally {
      setBusy(false)
      setDraggingZip(false)
    }
  }

  const handleZipDrop: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setDraggingZip(false)
    const file = event.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined
    const filePath = file?.path
    if (!filePath) {
      setError('未获取到 ZIP 文件路径，请改用“选择 ZIP 文件”')
      return
    }
    if (!filePath.toLowerCase().endsWith('.zip')) {
      setError('仅支持安装 ZIP 文件')
      return
    }
    void installZipPath(filePath)
  }

  const handlePickZip = async () => {
    const dialog = window.intools?.dialog
    if (!dialog?.showOpenDialog) {
      setError('文件选择 API 未就绪')
      return
    }
    try {
      const filePaths = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'ZIP', extensions: ['zip'] }]
      })
      if (!filePaths || filePaths.length === 0) return
      await installZipPath(filePaths[0])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`选择 ZIP 失败：${message}`)
    }
  }

  const handleMarkdownLinkClick = async (href: string | undefined, event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const url = String(href || '').trim()
    if (!url) return
    try {
      if (window.intools?.shell?.openExternal) {
        await window.intools.shell.openExternal(url)
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="flex h-full flex-col bg-white/50 dark:bg-slate-900/30">
      <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white px-6 py-4 dark:border-slate-800/80 dark:bg-slate-900">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
          title="返回"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">AI Skills</div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">Skills 管理中心</div>
        </div>
        <div className="flex items-center gap-2">
          <button className={`${secondaryPillClass} no-drag`} onClick={() => setShowCreateModal(true)} disabled={loading || busy}>AI 创建</button>
          <button className={`${secondaryPillClass} no-drag`} onClick={() => setShowZipModal(true)} disabled={loading || busy}>ZIP 安装</button>
          <button className={`${secondaryPillClass} no-drag`} onClick={() => void loadSkills(true)} disabled={loading || busy}>刷新</button>
        </div>
      </div>

      {(error || info) && (
        <div className="border-b border-slate-200/70 bg-white px-6 py-3 dark:border-slate-800/80 dark:bg-slate-900">
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
              {info}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 no-drag">
        <aside className="w-[340px] shrink-0 border-r border-slate-200/70 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">已安装 Skills</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">{skills.length}</span>
          </div>
          <div className="relative h-[calc(100%-28px)] overflow-y-auto space-y-2">
            {loading && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  加载中...
                </div>
              </div>
            )}
            {!loading && skills.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                暂无 Skills。请点击右上角“AI 创建”或“ZIP 安装”。
              </div>
            )}
            {skills.map((skill) => {
              const active = selectedSkillId === skill.id
              return (
                <button
                  key={skill.id}
                  type="button"
                  className={`w-full rounded-2xl border px-3 py-2 text-left transition ${active
                      ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-800/60'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950'
                    }`}
                  onClick={() => setSelectedSkillId(skill.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{skill.descriptor.name || skill.id}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${skill.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {skill.enabled ? '已启用' : '停用'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="truncate">{skill.id}</span>
                    <span className={`rounded-full px-1.5 py-0.5 ${skill.origin === 'system' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}>
                      {skill.origin === 'system' ? 'System' : 'App'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <main className="flex-1 min-h-0 overflow-hidden p-6">
          <div className="mx-auto h-full max-w-5xl">
            <section className="h-full min-h-0 rounded-[24px] bg-white p-2 dark:bg-slate-900 flex flex-col space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Skill 预览</h3>
                  {selectedSkill && (
                    <div className="group relative">
                      <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-[11px] text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 no-drag"
                        title="查看详情信息"
                      >
                        i
                      </button>
                      <div className="pointer-events-none invisible absolute left-0 top-full z-20 mt-2 w-[360px] rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        <div className="grid grid-cols-1 gap-2">
                          <div>ID：<span className="text-slate-800 dark:text-slate-100">{selectedSkill.id}</span></div>
                          <div>来源：<span className="text-slate-800 dark:text-slate-100">{selectedSkill.origin === 'system' ? '系统目录' : '应用目录'}</span></div>
                          <div>类型：<span className="text-slate-800 dark:text-slate-100">{selectedSkill.source}</span></div>
                          <div>可编辑：<span className="text-slate-800 dark:text-slate-100">{selectedSkill.readonly || selectedSkill.origin === 'system' ? '否' : '是'}</span></div>
                          {selectedSkill.skillMdPath && (
                            <div className="break-all">文件：<span className="text-slate-800 dark:text-slate-100">{selectedSkill.skillMdPath}</span></div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button className={`${actionButtonClass} no-drag`} onClick={handleToggleEnabled} disabled={!selectedSkill || busy}>
                    {selectedSkill?.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    className={`${actionButtonClass} no-drag`}
                    onClick={handleDeleteSkill}
                    disabled={!selectedSkill || selectedSkill.readonly || selectedSkill.origin === 'system' || busy}
                  >
                    删除
                  </button>
                </div>
              </div>

              {!selectedSkill && (
                <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  请先在左侧选择一个 Skill。
                </div>
              )}

              {selectedSkill && (
                <>
                  <div className="min-h-0 flex-1 overflow-auto">
                    {Object.keys(parsedSkillMarkdown.frontmatter).length > 0 && (
                      <div className="mb-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Skill Metadata</div>
                        <div className="mt-1 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                              {frontmatterValueToText(parsedSkillMarkdown.frontmatter.name) || selectedSkill.descriptor.name || selectedSkill.id}
                            </div>
                            {frontmatterValueToText(parsedSkillMarkdown.frontmatter.description) && (
                              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                {frontmatterValueToText(parsedSkillMarkdown.frontmatter.description)}
                              </div>
                            )}
                          </div>
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter.mode) && (
                            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {frontmatterValueToText(parsedSkillMarkdown.frontmatter.mode)}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 dark:text-slate-400 lg:grid-cols-2">
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter.id) && (
                            <div>ID：<span className="text-slate-700 dark:text-slate-200">{frontmatterValueToText(parsedSkillMarkdown.frontmatter.id)}</span></div>
                          )}
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter.author) && (
                            <div>作者：<span className="text-slate-700 dark:text-slate-200">{frontmatterValueToText(parsedSkillMarkdown.frontmatter.author)}</span></div>
                          )}
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter.version) && (
                            <div>版本：<span className="text-slate-700 dark:text-slate-200">{frontmatterValueToText(parsedSkillMarkdown.frontmatter.version)}</span></div>
                          )}
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter.tags) && (
                            <div className="lg:col-span-2">标签：<span className="text-slate-700 dark:text-slate-200">{frontmatterValueToText(parsedSkillMarkdown.frontmatter.tags)}</span></div>
                          )}
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter.triggerPhrases) && (
                            <div className="lg:col-span-2">触发词：<span className="text-slate-700 dark:text-slate-200">{frontmatterValueToText(parsedSkillMarkdown.frontmatter.triggerPhrases)}</span></div>
                          )}
                        </div>
                      </div>
                    )}
                    {selectedSkillContent ? (
                      <article className="prose prose-sm prose-slate max-w-none dark:prose-invert">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ href, children, ...props }) => (
                              <a
                                {...props}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => void handleMarkdownLinkClick(href, event)}
                              >
                                {children}
                              </a>
                            )
                          }}
                        >
                          {parsedSkillMarkdown.body}
                        </ReactMarkdown>
                      </article>
                    ) : (
                      <div className="text-xs text-slate-500 dark:text-slate-400">未读取到 SKILL.md 内容</div>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </main>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-drag">
          <div className="w-full max-w-3xl rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI 创建 Skill</h3>
              <button className={`${actionButtonClass} no-drag`} onClick={() => setShowCreateModal(false)} disabled={busy}>关闭</button>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
              <label className="space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">创建模型（已启用）</div>
                <select className={inputClass} value={selectedCreateModel} onChange={(e) => setSelectedCreateModel(e.target.value)}>
                  {createModels.length === 0 && <option value="">无可用模型</option>}
                  {createModels.map((model) => (
                    <option key={model.id} value={model.id}>{model.label} ({model.id})</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">需求描述</div>
                <textarea
                  className={inputClass}
                  rows={6}
                  value={createRequirements}
                  onChange={(e) => setCreateRequirements(e.target.value)}
                  placeholder="描述你要创建的 Skill 能力、触发场景、输出要求..."
                />
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button className={`${secondaryPillClass} no-drag`} onClick={() => setShowCreateModal(false)} disabled={busy}>取消</button>
              <button className={`${primaryPillClass} no-drag`} onClick={handleCreateWithAi} disabled={busy || !createRequirements.trim() || !selectedCreateModel}>开始创建</button>
            </div>
          </div>
        </div>
      )}

      {showZipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-drag">
          <div className="w-full max-w-2xl rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">ZIP 安装 Skill</h3>
              <button className={`${actionButtonClass} no-drag`} onClick={() => setShowZipModal(false)} disabled={busy}>关闭</button>
            </div>
            <div
              className={`rounded-2xl border border-dashed p-8 text-center text-sm transition ${draggingZip
                  ? 'border-slate-400 bg-slate-50 text-slate-800 dark:border-slate-500 dark:bg-slate-800/60 dark:text-slate-100'
                  : 'border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400'
                }`}
              onDragEnter={(e) => {
                e.preventDefault()
                setDraggingZip(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setDraggingZip(false)
              }}
              onDrop={handleZipDrop}
            >
              拖拽 `.zip` 到此处安装（自动解压到应用内部 skills 目录）
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button className={`${secondaryPillClass} no-drag`} onClick={() => setShowZipModal(false)} disabled={busy}>取消</button>
              <button className={`${primaryPillClass} no-drag`} onClick={() => void handlePickZip()} disabled={busy}>选择 ZIP 文件</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
