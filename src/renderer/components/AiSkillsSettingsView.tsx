import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEventHandler, MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import YAML from 'yaml'
import type { AiSkillCreateModelOption, AiSkillCreateProgressChunk, AiSkillCreateStage, AiSkillRecord } from '../../shared/types/ai'
import { useInAppNotice } from './InAppNotice'
import UnifiedSelect from './UnifiedSelect'

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
  try {
    const parsed = YAML.parse(frontmatterRaw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [rawKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
        const key = String(rawKey || '').trim()
        if (!key) continue
        if (Array.isArray(rawValue)) {
          out[key] = rawValue.map((item) => String(item ?? '')).filter(Boolean)
          continue
        }
        if (rawValue && typeof rawValue === 'object') {
          out[key] = JSON.stringify(rawValue, null, 2)
          continue
        }
        out[key] = String(rawValue ?? '')
      }
    }
  } catch {
    // Ignore YAML parse failure and fallback to empty frontmatter preview.
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

type CreateTimelineStatus = 'pending' | 'active' | 'done' | 'error'

interface CreateTimelineItem {
  stage: AiSkillCreateStage
  label: string
  status: CreateTimelineStatus
  detail?: string
  updatedAt?: number
}

const CREATE_TIMELINE_ORDER: Array<{ stage: AiSkillCreateStage; label: string }> = [
  { stage: 'generating', label: '生成中' },
  { stage: 'parsing', label: '解析中' },
  { stage: 'validating', label: '校验中' },
  { stage: 'writing', label: '写入中' },
  { stage: 'completed', label: '完成' }
]

function buildInitialCreateTimeline(): CreateTimelineItem[] {
  return CREATE_TIMELINE_ORDER.map((item) => ({
    stage: item.stage,
    label: item.label,
    status: 'pending'
  }))
}

function inferCreateStage(text: string): AiSkillCreateStage | undefined {
  const value = String(text || '')
  if (!value) return undefined
  if (value.includes('生成')) return 'generating'
  if (value.includes('解析')) return 'parsing'
  if (value.includes('校验')) return 'validating'
  if (value.includes('写入') || value.includes('落盘')) return 'writing'
  if (value.includes('完成')) return 'completed'
  return undefined
}

function inferCreateStageStatus(text: string): 'start' | 'done' | 'error' {
  const value = String(text || '')
  if (value.includes('失败') || value.includes('错误')) return 'error'
  if (value.includes('完成') || value.includes('已')) return 'done'
  return 'start'
}

function updateTimelineFromChunk(prev: CreateTimelineItem[], chunk: AiSkillCreateProgressChunk): CreateTimelineItem[] {
  const stage = chunk.stage || inferCreateStage(chunk.text)
  const stageStatus = chunk.stageStatus || inferCreateStageStatus(chunk.text)
  if (!stage) {
    if (stageStatus !== 'error') return prev
    const next = prev.map((item) => ({ ...item }))
    const now = Date.now()
    const activeIndex = next.findIndex((item) => item.status === 'active')
    const targetIndex = activeIndex >= 0 ? activeIndex : 0
    next[targetIndex] = {
      ...next[targetIndex],
      status: 'error',
      detail: chunk.text || next[targetIndex].detail,
      updatedAt: now
    }
    return next
  }
  const next = prev.map((item) => ({ ...item }))
  const targetIndex = next.findIndex((item) => item.stage === stage)
  if (targetIndex < 0) return prev
  const now = Date.now()

  if (stageStatus === 'start') {
    for (let i = 0; i < targetIndex; i += 1) {
      if (next[i].status === 'pending' || next[i].status === 'active') {
        next[i].status = 'done'
      }
    }
    next[targetIndex] = {
      ...next[targetIndex],
      status: 'active',
      detail: chunk.text || next[targetIndex].detail,
      updatedAt: now
    }
    return next
  }

  if (stageStatus === 'done') {
    for (let i = 0; i < targetIndex; i += 1) {
      if (next[i].status === 'pending' || next[i].status === 'active') {
        next[i].status = 'done'
      }
    }
    next[targetIndex] = {
      ...next[targetIndex],
      status: 'done',
      detail: chunk.text || next[targetIndex].detail,
      updatedAt: now
    }
    if (stage === 'completed') {
      for (let i = 0; i < targetIndex; i += 1) {
        next[i].status = 'done'
      }
    }
    return next
  }

  let activeIndex = next.findIndex((item) => item.status === 'active')
  if (activeIndex < 0) {
    activeIndex = targetIndex
  }
  next[activeIndex] = {
    ...next[activeIndex],
    status: 'error',
    detail: chunk.text || next[activeIndex].detail,
    updatedAt: now
  }
  return next
}

function formatTimelineTime(value?: number): string {
  if (!value) return ''
  const date = new Date(value)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function timelineStatusText(status: CreateTimelineStatus): string {
  if (status === 'active') return '进行中'
  if (status === 'done') return '已完成'
  if (status === 'error') return '失败'
  return '等待'
}

export default function AiSkillsSettingsView({ onBack }: AiSkillsSettingsViewProps) {
  const [skills, setSkills] = useState<AiSkillRecord[]>([])
  const [skillSearchQuery, setSkillSearchQuery] = useState('')
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
  const [createTimeline, setCreateTimeline] = useState<CreateTimelineItem[]>(() => buildInitialCreateTimeline())
  const [createStreamText, setCreateStreamText] = useState('')
  const [createRawModelOutput, setCreateRawModelOutput] = useState('')
  const [lastCreatedSkillId, setLastCreatedSkillId] = useState<string | null>(null)
  const [creatingSkill, setCreatingSkill] = useState(false)
  const createOutputRef = useRef('')
  const notice = useInAppNotice()

  const setError = useCallback((message: string | null) => {
    if (message) notice.error(message)
  }, [notice])

  const setInfo = useCallback((message: string | null) => {
    if (message) notice.success(message)
  }, [notice])

  const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50'
  const primaryPillClass = 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white shadow-sm transition dark:border-white dark:bg-white dark:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60'
  const secondaryPillClass = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

  const selectedSkill = useMemo(
    () => (selectedSkillId ? skills.find((item) => item.id === selectedSkillId) || null : null),
    [selectedSkillId, skills]
  )
  const filteredSkills = useMemo(() => {
    const keyword = skillSearchQuery.trim().toLowerCase()
    if (!keyword) return skills
    return skills.filter((skill) => {
      const name = String(skill.descriptor.name || '').toLowerCase()
      const id = String(skill.id || '').toLowerCase()
      const description = String(skill.descriptor.description || '').toLowerCase()
      return name.includes(keyword) || id.includes(keyword) || description.includes(keyword)
    })
  }, [skillSearchQuery, skills])
  const parsedSkillMarkdown = useMemo(() => parseSkillMarkdown(selectedSkillContent), [selectedSkillContent])
  const focusedTimelineItem = useMemo(() => {
    const errored = createTimeline.find((item) => item.status === 'error')
    if (errored) return errored
    const active = createTimeline.find((item) => item.status === 'active')
    if (active) return active
    const withDetail = [...createTimeline]
      .filter((item) => !!item.detail)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return withDetail[0] || null
  }, [createTimeline])

  const loadSkills = async (forceRefresh = false) => {
    if (!window.mulby?.ai?.skills?.list) {
      setError('Skills API 未就绪，请重启应用')
      return
    }
    setLoading(true)
    try {
      const list = forceRefresh && window.mulby.ai.skills.refresh
        ? await window.mulby.ai.skills.refresh()
        : await window.mulby.ai.skills.list()
      setSkills(list)
      const models = window.mulby.ai.skills.listCreateModels
        ? await window.mulby.ai.skills.listCreateModels()
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
      if (filePath && (window.mulby as any)?.filesystem?.readFile) {
        try {
          const content = await (window.mulby as any).filesystem.readFile(filePath, 'utf-8')
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
    if (filteredSkills.length === 0) return
    if (!selectedSkillId || !filteredSkills.some((item) => item.id === selectedSkillId)) {
      setSelectedSkillId(filteredSkills[0].id)
    }
  }, [filteredSkills, selectedSkillId])

  const handleToggleEnabled = async () => {
    if (!selectedSkill || !window.mulby?.ai?.skills) return
    setBusy(true)
    try {
      if (selectedSkill.enabled) {
        await window.mulby.ai.skills.disable(selectedSkill.id)
      } else {
        await window.mulby.ai.skills.enable(selectedSkill.id)
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
    if (!selectedSkill || selectedSkill.readonly || selectedSkill.origin === 'system' || !window.mulby?.ai?.skills?.remove) return
    const ok = window.confirm(`确认删除 Skill「${selectedSkill.descriptor.name || selectedSkill.id}」吗？`)
    if (!ok) return
    setBusy(true)
    try {
      await window.mulby.ai.skills.remove(selectedSkill.id)
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
    if (!window.mulby?.ai?.skills?.createWithAi) {
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
    const previousRaw = String(createRawModelOutput || '').trim()
    const isRevision = Boolean(previousRaw)
    const requestText = isRevision
      ? [
        `请在已有 Skill 草稿基础上修改：${requirements}`,
        '',
        '请完整返回新的 JSON，不要省略字段。',
        `上一次模型输出 JSON：\n${previousRaw}`
      ].join('\n')
      : requirements
    createOutputRef.current = ''
    setCreateTimeline(() => {
      const next = buildInitialCreateTimeline()
      next[0] = {
        ...next[0],
        status: 'active',
        detail: `已提交创建请求（模型：${selectedCreateModel}）`,
        updatedAt: Date.now()
      }
      return next
    })
    setCreateStreamText('')
    setCreateRawModelOutput('')
    setCreatingSkill(true)
    setBusy(true)
    try {
      const input = {
        requirements: requestText,
        model: selectedCreateModel,
        previousRawText: isRevision ? previousRaw : undefined,
        replaceSkillId: isRevision ? (lastCreatedSkillId || undefined) : undefined,
        enabled: false,
        trustLevel: 'reviewed' as const,
        modePreference: 'both' as const
      }
      const onChunk = (chunk: AiSkillCreateProgressChunk) => {
        if (!chunk || !chunk.text) return
        if (chunk.type === 'status') {
          setCreateTimeline((prev) => updateTimelineFromChunk(prev, chunk))
          return
        }
        createOutputRef.current += chunk.text
        setCreateStreamText(createOutputRef.current)
      }

      const result = window.mulby.ai.skills.createWithAiStream
        ? await window.mulby.ai.skills.createWithAiStream(input, onChunk)
        : await window.mulby.ai.skills.createWithAi(input)
      const finalRawText = String(result?.generation?.rawText || createOutputRef.current || '')
      if (finalRawText) {
        createOutputRef.current = finalRawText
        setCreateStreamText(finalRawText)
        setCreateRawModelOutput(finalRawText)
      }
      setCreateTimeline((prev) =>
        updateTimelineFromChunk(prev, {
          type: 'status',
          stage: 'completed',
          stageStatus: 'done',
          text: '完成：Skill 已保存到应用目录'
        })
      )
      await loadSkills(true)
      if (result?.record?.id) {
        setSelectedSkillId(result.record.id)
        setLastCreatedSkillId(result.record.id)
      }
      setInfo(`${isRevision ? 'AI 已更新 Skill' : 'AI 已创建 Skill'}：${result.record.descriptor.name || result.record.id}`)
      setError(null)
      setCreateRequirements('')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`AI 创建失败：${message}`)
      setCreateTimeline((prev) =>
        updateTimelineFromChunk(prev, {
          type: 'status',
          stageStatus: 'error',
          text: `创建失败：${message}`
        })
      )
    } finally {
      setBusy(false)
      setCreatingSkill(false)
    }
  }

  const handleResetCreateSession = () => {
    createOutputRef.current = ''
    setCreateStreamText('')
    setCreateRawModelOutput('')
    setLastCreatedSkillId(null)
    setCreateTimeline(buildInitialCreateTimeline())
    setInfo('已开始新的创建会话')
    setError(null)
  }

  const handleCopyModelOutput = async () => {
    const text = String(createRawModelOutput || createStreamText || '').trim()
    if (!text) {
      setError('暂无可复制的模型输出')
      return
    }
    try {
      if (window.mulby?.clipboard?.writeText) {
        await window.mulby.clipboard.writeText(text)
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        throw new Error('系统剪贴板不可用')
      }
      setInfo('已复制完整模型输出')
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`复制失败：${message}`)
    }
  }

  const installZipPath = async (zipPath: string) => {
    if (!window.mulby?.ai?.skills?.install) {
      setError('Skills 安装 API 未就绪')
      return
    }
    setBusy(true)
    try {
      const installed = await window.mulby.ai.skills.install({
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
    const dialog = window.mulby?.dialog
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
      if (window.mulby?.shell?.openExternal) {
        await window.mulby.shell.openExternal(url)
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleOpenSkillFolder = async () => {
    if (!selectedSkill) return
    try {
      const shell = window.mulby?.shell
      if (!shell) {
        setError('系统 shell API 未就绪')
        return
      }
      if (selectedSkill.installPath && shell.openFolder) {
        await shell.openFolder(selectedSkill.installPath)
        return
      }
      if (selectedSkill.skillMdPath && shell.showItemInFolder) {
        await shell.showItemInFolder(selectedSkill.skillMdPath)
        return
      }
      const fallbackPath = selectedSkill.installPath || selectedSkill.skillMdPath
      if (fallbackPath && shell.openPath) {
        await shell.openPath(fallbackPath)
        return
      }
      setError('未找到可打开的 Skill 目录路径')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`打开目录失败：${message}`)
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

      <div className="flex min-h-0 flex-1 no-drag">
        <aside className="flex min-h-0 w-[340px] shrink-0 flex-col border-r border-slate-200/70 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">已安装 Skills</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {skillSearchQuery.trim() ? `${filteredSkills.length}/${skills.length}` : skills.length}
            </span>
          </div>
          <div className="relative mb-3">
            <input
              type="text"
              value={skillSearchQuery}
              onChange={(event) => setSkillSearchQuery(event.target.value)}
              placeholder="搜索名称 / ID / 描述"
              className={`${inputClass} py-1.5 pr-9 text-xs`}
            />
            {skillSearchQuery && (
              <button
                type="button"
                aria-label="清空搜索"
                title="清空搜索"
                className="no-drag absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                onClick={() => setSkillSearchQuery('')}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          <div className="relative min-h-0 flex-1 overflow-y-auto space-y-2">
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
            {!loading && skills.length > 0 && filteredSkills.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                没有匹配的 Skill，请调整搜索关键词。
              </div>
            )}
            {filteredSkills.map((skill) => {
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
                  <button
                    className={`${actionButtonClass} no-drag`}
                    onClick={handleOpenSkillFolder}
                    disabled={!selectedSkill || (!selectedSkill.installPath && !selectedSkill.skillMdPath) || busy}
                  >
                    打开目录
                  </button>
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
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 dark:text-slate-400 lg:grid-cols-2">
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter.license) && (
                            <div>许可证：<span className="text-slate-700 dark:text-slate-200">{frontmatterValueToText(parsedSkillMarkdown.frontmatter.license)}</span></div>
                          )}
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter.compatibility) && (
                            <div>兼容性：<span className="text-slate-700 dark:text-slate-200">{frontmatterValueToText(parsedSkillMarkdown.frontmatter.compatibility)}</span></div>
                          )}
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter['allowed-tools']) && (
                            <div className="lg:col-span-2">允许工具：<span className="text-slate-700 dark:text-slate-200">{frontmatterValueToText(parsedSkillMarkdown.frontmatter['allowed-tools'])}</span></div>
                          )}
                          {frontmatterValueToText(parsedSkillMarkdown.frontmatter.metadata) && (
                            <div className="lg:col-span-2 break-all">metadata：<span className="text-slate-700 dark:text-slate-200">{frontmatterValueToText(parsedSkillMarkdown.frontmatter.metadata)}</span></div>
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
          <div className="w-full max-w-2xl rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-2xl dark:border-slate-800/80 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI 创建 Skill</h3>
              <button className={`${actionButtonClass} no-drag`} onClick={() => setShowCreateModal(false)} disabled={busy}>关闭</button>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
              <label className="space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">创建模型（已启用）</div>
                <UnifiedSelect value={selectedCreateModel} onChange={(e) => setSelectedCreateModel(e.target.value)}>
                  {createModels.length === 0 && <option value="">无可用模型</option>}
                  {createModels.map((model) => (
                    <option key={model.id} value={model.id}>{model.label} ({model.id})</option>
                  ))}
                </UnifiedSelect>
              </label>
              <label className="space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">需求描述</div>
                <textarea
                  className={inputClass}
                  rows={5}
                  value={createRequirements}
                  onChange={(e) => setCreateRequirements(e.target.value)}
                  placeholder={createRawModelOutput ? '继续补充修改要求，例如：增加触发词、压缩提示词、补充脚本...' : '描述你要创建的 Skill 能力、触发场景、输出要求...'}
                />
              </label>
            </div>
            {createRawModelOutput && (
              <div className="mt-3 rounded-xl border border-blue-200/80 bg-blue-50/70 px-3 py-2 text-[11px] text-blue-700 dark:border-blue-900/70 dark:bg-blue-900/20 dark:text-blue-300">
                已进入连续修改模式：下一次提交会基于上一次模型输出继续优化，并覆盖更新当前 Skill。
              </div>
            )}
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">创建进度</div>
                <div className="overflow-x-auto pb-1">
                  <div className="flex min-w-[560px] items-start">
                    {createTimeline.map((item, index) => {
                      const dotClass = item.status === 'done'
                        ? 'bg-emerald-500'
                        : item.status === 'active'
                          ? 'bg-blue-500 animate-pulse'
                          : item.status === 'error'
                            ? 'bg-red-500'
                            : 'bg-slate-300 dark:bg-slate-700'
                      const lineClass = item.status === 'done'
                        ? 'bg-emerald-300 dark:bg-emerald-700/70'
                        : item.status === 'active'
                          ? 'bg-blue-300 dark:bg-blue-700/70'
                          : item.status === 'error'
                            ? 'bg-red-300 dark:bg-red-700/70'
                            : 'bg-slate-200 dark:bg-slate-700'
                      return (
                        <div key={item.stage} className="flex items-start">
                          <div className="w-[96px] text-center">
                            <div className="mx-auto flex w-full items-center justify-center">
                              <div className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
                            </div>
                            <div className="mt-1 truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">{item.label}</div>
                            <div className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] ${item.status === 'done'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : item.status === 'active'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : item.status === 'error'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                              }`}>
                              {timelineStatusText(item.status)}
                            </div>
                            <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                              {item.updatedAt ? formatTimelineTime(item.updatedAt) : '--:--:--'}
                            </div>
                          </div>
                          {index < createTimeline.length - 1 && (
                            <div className={`mt-[6px] h-[2px] w-8 ${lineClass}`} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {focusedTimelineItem?.detail && (
                  <div className="mt-2 rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                    <span className="font-medium text-slate-600 dark:text-slate-200">{focusedTimelineItem.label}：</span>
                    {focusedTimelineItem.detail}
                  </div>
                )}
                {!focusedTimelineItem?.detail && (
                  <div className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                    等待创建任务开始...
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-slate-600 dark:text-slate-300">模型输出（流式）</div>
                  <button
                    type="button"
                    className={`${actionButtonClass} no-drag !px-2 !py-1`}
                    onClick={() => void handleCopyModelOutput()}
                    disabled={!String(createRawModelOutput || createStreamText || '').trim()}
                  >
                    复制完整模型输出
                  </button>
                </div>
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                  {createStreamText || '尚无输出'}
                </pre>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                className={`${secondaryPillClass} no-drag`}
                onClick={handleResetCreateSession}
                disabled={busy || (!createRawModelOutput && !createStreamText)}
              >
                新建会话
              </button>
              <div className="flex items-center gap-2">
                <button className={`${secondaryPillClass} no-drag`} onClick={() => setShowCreateModal(false)} disabled={busy}>取消</button>
                <button className={`${primaryPillClass} no-drag`} onClick={handleCreateWithAi} disabled={busy || !createRequirements.trim() || !selectedCreateModel}>
                  {creatingSkill ? '处理中…' : (createRawModelOutput ? '继续修改' : '开始创建')}
                </button>
              </div>
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
