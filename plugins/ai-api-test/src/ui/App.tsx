import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Wand2, Image as ImageIcon, Play, PlusCircle } from 'lucide-react'
import { useMulby } from './hooks/useMulby'

type AiAttachmentRef = {
  attachmentId: string
  mimeType: string
  size: number
  filename?: string
  purpose?: string
}

type ModelItem = { id: string; label?: string; description?: string; providerLabel?: string; capabilities?: Array<{ type: string; isUserSelected?: boolean }> }
type McpServer = {
  id: string
  name: string
  type: 'stdio' | 'sse' | 'streamableHttp'
  isActive: boolean
  description?: string
}
type SkillRecord = {
  id: string
  enabled: boolean
  origin?: 'system' | 'app'
  readonly?: boolean
  descriptor?: {
    id?: string
    name?: string
    description?: string
    tags?: string[]
    mode?: 'manual' | 'auto' | 'both'
  }
}
type SkillMode = 'off' | 'manual' | 'auto'

const defaultSystemPrompt = '你是一个专业的 AI API 测试助手。'
const defaultUserPrompt = '请用简短中文说明今天的测试进度，并给一个下一步建议。'
const defaultMcpPrompt = '请优先调用可用的 MCP 工具完成任务，并简要说明调用了哪些工具。'
const defaultSkillsPrompt = '请根据我的输入给出结构化方案，并明确说明你应用了哪些 Skills。'

const guessMimeType = (file: File) => {
  if (file.type) return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  if (name.endsWith('.txt')) return 'text/plain'
  if (name.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

const extractText = (content?: string | Array<any>) => {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || '').join('')
  }
  return ''
}

const toPreview = (value: unknown, maxLength = 180) => {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (!text) return ''
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  } catch {
    return '[unserializable]'
  }
}

const inferImageMimeFromBase64 = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, '')
  if (normalized.startsWith('/9j/')) return 'image/jpeg'
  if (normalized.startsWith('iVBORw0KGgo')) return 'image/png'
  if (normalized.startsWith('UklGR')) return 'image/webp'
  if (normalized.startsWith('R0lGOD')) return 'image/gif'
  return 'image/png'
}

const toImageSrc = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('data:')) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  const mime = inferImageMimeFromBase64(raw)
  return `data:${mime};base64,${raw}`
}

export default function App() {
  const { ai, notification, host, dialog } = useMulby('ai-api-test') as any

  const [, setTheme] = useState<'light' | 'dark'>('light')
  const [models, setModels] = useState<ModelItem[]>([])
  const [modelsJson, setModelsJson] = useState('')
  const [selectedModel, setSelectedModel] = useState('')

  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt)
  const [userPrompt, setUserPrompt] = useState(defaultUserPrompt)
  const [reasoningOutput, setReasoningOutput] = useState('')
  const [streamOutput, setStreamOutput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const [tokenEstimate, setTokenEstimate] = useState('')
  const [tokenActual, setTokenActual] = useState('')
  const [settingsJson, setSettingsJson] = useState('')

  const [attachments, setAttachments] = useState<AiAttachmentRef[]>([])
  const [attachmentInfo, setAttachmentInfo] = useState('')
  const [attachmentPurpose, setAttachmentPurpose] = useState('vision')
  const [providerOverride, setProviderOverride] = useState('')
  const [providerUploadPurpose, setProviderUploadPurpose] = useState('agent')
  const [providerUploadInfo, setProviderUploadInfo] = useState('')

  const [imageGenPrompt, setImageGenPrompt] = useState('A cute robot in watercolor style')
  const [imageGenModel, setImageGenModel] = useState('')
  const [imageGenSize, setImageGenSize] = useState('1024x1024')
  const [imageGenCount, setImageGenCount] = useState(1)
  const [isImageGenerating, setIsImageGenerating] = useState(false)
  const [imageGenProgress, setImageGenProgress] = useState('')
  const [imageGenPreviewImages, setImageGenPreviewImages] = useState<string[]>([])
  const [generatedImages, setGeneratedImages] = useState<string[]>([])

  const [imageEditPrompt, setImageEditPrompt] = useState('Add a red scarf')
  const [imageEditModel, setImageEditModel] = useState('')
  const [selectedImageAttachment, setSelectedImageAttachment] = useState('')
  const [editedImages, setEditedImages] = useState<string[]>([])

  const [connectionStream, setConnectionStream] = useState('')
  const [connectionReasoning, setConnectionReasoning] = useState('')

  const [toolPrompt, setToolPrompt] = useState('请先调用 sumNumbers 计算 12 + 30，然后再调用getSystemInfo返回给我系统信息，最后以"计算结果:xx；系统信息:"的格式返回给我')
  const [toolResult, setToolResult] = useState('')
  const [toolStreamOutput, setToolStreamOutput] = useState('')
  const [isToolStreaming, setIsToolStreaming] = useState(false)
  const toolStreamBufferRef = useRef('')
  const toolReasoningOpenedRef = useRef(false)
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [selectedMcpServerId, setSelectedMcpServerId] = useState('')
  const [mcpMode, setMcpMode] = useState<'off' | 'manual' | 'auto'>('manual')
  const [mcpPrompt, setMcpPrompt] = useState(defaultMcpPrompt)
  const [mcpCheckResult, setMcpCheckResult] = useState('')
  const [mcpToolsJson, setMcpToolsJson] = useState('')
  const [mcpLogsJson, setMcpLogsJson] = useState('')
  const [mcpCallOutput, setMcpCallOutput] = useState('')
  const [mcpCallResult, setMcpCallResult] = useState('')
  const [isMcpCalling, setIsMcpCalling] = useState(false)
  const mcpCallIdRef = useRef<string | null>(null)
  const mcpCallSessionRef = useRef<string>('')
  const mcpReasoningOpenedRef = useRef(false)

  const [skillsList, setSkillsList] = useState<SkillRecord[]>([])
  const [skillsMode, setSkillsMode] = useState<SkillMode>('manual')
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [skillsPrompt, setSkillsPrompt] = useState(defaultSkillsPrompt)
  const [skillsPreviewJson, setSkillsPreviewJson] = useState('')
  const [skillsResolveJson, setSkillsResolveJson] = useState('')
  const [skillsCallOutput, setSkillsCallOutput] = useState('')
  const [skillsCallResult, setSkillsCallResult] = useState('')
  const [skillsCapabilityDebugJson, setSkillsCapabilityDebugJson] = useState('')
  const [isSkillsCalling, setIsSkillsCalling] = useState(false)
  const skillsReasoningOpenedRef = useRef(false)
  const [policyDebugEntries, setPolicyDebugEntries] = useState<Array<{
    at: string
    scene: string
    stage: 'chunk' | 'final'
    policy: any
  }>>([])

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const streamRequestRef = useRef<any>(null)
  const streamRequestIdRef = useRef<string | null>(null)
  const imageGenerateRequestRef = useRef<any>(null)
  const mcpRequestRef = useRef<any>(null)
  const skillsRequestRef = useRef<any>(null)
  const skillsRequestIdRef = useRef<string | null>(null)
  const imageProgressTimerRef = useRef<number | null>(null)
  const imageProgressStartAtRef = useRef<number>(0)

  const clearImageProgressTimer = () => {
    if (imageProgressTimerRef.current) {
      window.clearInterval(imageProgressTimerRef.current)
      imageProgressTimerRef.current = null
    }
  }

  const startImageProgressTimer = () => {
    clearImageProgressTimer()
    imageProgressStartAtRef.current = Date.now()
    imageProgressTimerRef.current = window.setInterval(() => {
      const seconds = Math.max(1, Math.floor((Date.now() - imageProgressStartAtRef.current) / 1000))
      setImageGenProgress(`生成中... ${seconds}s`)
    }, 1000)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })
    return () => {
      clearImageProgressTimer()
    }
  }, [])

  const loadModels = async () => {
    try {
      const list = await ai?.allModels?.()
      const normalized = Array.isArray(list)
        ? list.map((item: any) => ({
          id: item.id,
          label: item.label,
          description: item.description,
          providerLabel: item.providerLabel,
          capabilities: item.capabilities || []
        }))
        : []
      setModels(normalized)
      const withProviderDisplay = normalized.map((item) => {
        const providerId = item.id.includes(':') ? item.id.split(':', 2)[0] : 'unknown'
        return {
          ...item,
          providerId,
          providerLabel: item.providerLabel,
          provider: item.providerLabel || providerId,
          capabilities: item.capabilities || []
        }
      })
      setModelsJson(JSON.stringify(withProviderDisplay, null, 2))
      if (!selectedModel && normalized.length > 0) {
        setSelectedModel(normalized[0].id)
      }
      const fallbackModel = selectedModel || normalized[0]?.id || ''
      if (fallbackModel) {
        setImageGenModel((prev) => prev || fallbackModel)
        setImageEditModel((prev) => prev || fallbackModel)
      }
      notification?.show?.('模型列表已加载', 'success')
    } catch (err: any) {
      notification?.show?.(err?.message || '模型列表加载失败', 'error')
    }
  }

  const loadMcpServers = async () => {
    try {
      const listServers = ai?.mcp?.listServers
      if (typeof listServers !== 'function') {
        setMcpServers([])
        setSelectedMcpServerId('')
        return
      }
      const list = await listServers()
      const normalized = Array.isArray(list) ? list : []
      setMcpServers(normalized)
      setSelectedMcpServerId((prev) => {
        if (prev && normalized.some((item: McpServer) => item.id === prev)) {
          return prev
        }
        return normalized[0]?.id || ''
      })
    } catch (err: any) {
      notification?.show?.(err?.message || '读取 MCP 服务器失败', 'error')
    }
  }

  const loadSkills = async () => {
    try {
      const listSkills = ai?.skills?.list
      const listEnabledSkills = ai?.skills?.listEnabled
      if (typeof listSkills !== 'function' && typeof listEnabledSkills !== 'function') {
        setSkillsList([])
        setSelectedSkillIds([])
        setSkillsPreviewJson('当前版本未暴露 ai.skills API')
        return
      }
      const list = typeof listSkills === 'function'
        ? await listSkills()
        : await listEnabledSkills?.()
      const normalized = Array.isArray(list) ? list : []
      setSkillsList(normalized)
      setSelectedSkillIds((prev) => {
        const valid = prev.filter((id) => normalized.some((item: SkillRecord) => item.id === id))
        if (valid.length > 0) return valid
        const defaults = normalized
          .filter((item: SkillRecord) => item.enabled)
          .slice(0, 3)
          .map((item: SkillRecord) => item.id)
        return defaults
      })
    } catch (err: any) {
      notification?.show?.(err?.message || '读取 Skills 失败', 'error')
    }
  }

  useEffect(() => {
    loadModels()
    loadMcpServers()
    loadSkills()
  }, [])

  useEffect(() => {
    if (!selectedModel) return
    if (!imageGenModel) setImageGenModel(selectedModel)
    if (!imageEditModel) setImageEditModel(selectedModel)
  }, [selectedModel, imageGenModel, imageEditModel])

  const recordPolicyDebug = (scene: string, stage: 'chunk' | 'final', payload: any) => {
    if (!payload || typeof payload !== 'object') return
    const entry = {
      at: new Date().toISOString(),
      scene,
      stage,
      policy: payload
    }
    setPolicyDebugEntries((prev) => [entry, ...prev].slice(0, 20))
  }

  const capturePolicyDebug = (scene: string, stage: 'chunk' | 'final', envelope: any) => {
    if (!envelope || typeof envelope !== 'object') return
    if (!envelope.policy_debug || typeof envelope.policy_debug !== 'object') return
    recordPolicyDebug(scene, stage, envelope.policy_debug)
  }

  const startStream = async () => {
    if (!selectedModel) {
      notification?.show?.('请先选择模型', 'warning')
      return
    }
    setReasoningOutput('')
    setStreamOutput('')
    setTokenActual('')
    setIsStreaming(true)

    try {
      console.info('[ai-api-test] stream start', { model: selectedModel })
      const req = ai?.call(
        {
          model: selectedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        },
        (chunk: any) => {
          console.info('[ai-api-test] stream chunk', chunk)
          if (chunk?.__requestId) {
            streamRequestIdRef.current = chunk.__requestId
            console.info('[ai-api-test] stream requestId set', chunk.__requestId)
          }
          capturePolicyDebug('chat-stream', 'chunk', chunk)
          if (chunk?.chunkType === 'end') {
            if (chunk?.usage) {
              setTokenActual(JSON.stringify(chunk.usage, null, 2))
            }
            return
          }
          if (chunk?.chunkType === 'error') {
            notification?.show?.(chunk?.error?.message || '流式请求出错', 'error')
            return
          }
          if (chunk?.reasoning_content) {
            setReasoningOutput((prev) => prev + chunk.reasoning_content)
          }
          const text = extractText(chunk?.content)
          if (text) {
            setStreamOutput((prev) => prev + text)
          }
        }
      )

      streamRequestRef.current = req
      streamRequestIdRef.current = (req as any)?.requestId ?? null
      const finalMessage = await req
      console.info('[ai-api-test] stream end', finalMessage)
      capturePolicyDebug('chat-stream', 'final', finalMessage)
      if (finalMessage?.reasoning_content) {
        setReasoningOutput(finalMessage.reasoning_content)
      }
      const finalText = extractText(finalMessage?.content)
      if (finalText) {
        setStreamOutput(finalText)
      }
      if (finalMessage?.usage) {
        setTokenActual(JSON.stringify(finalMessage.usage, null, 2))
      }
      streamRequestRef.current = null
      streamRequestIdRef.current = null
      setIsStreaming(false)
    } catch (err: any) {
      setIsStreaming(false)
      notification?.show?.(err?.message || '流式请求失败', 'error')
    }
  }

  const stopStream = () => {
    console.info('[ai-api-test] stop stream', {
      hasAbort: !!streamRequestRef.current?.abort,
      requestId: streamRequestIdRef.current,
      promiseRequestId: (streamRequestRef.current as any)?.requestId
    })
    if (streamRequestRef.current?.abort) {
      streamRequestRef.current.abort()
      streamRequestRef.current = null
      streamRequestIdRef.current = null
      setIsStreaming(false)
      notification?.show?.('已停止流式输出', 'warning')
      return
    }
    const requestId = (streamRequestRef.current as any)?.requestId || streamRequestIdRef.current
    if (requestId && ai?.abort) {
      ai.abort(requestId)
      streamRequestRef.current = null
      streamRequestIdRef.current = null
      setIsStreaming(false)
      notification?.show?.('已停止流式输出', 'warning')
      return
    }
    notification?.show?.('当前没有可停止的请求', 'info')
  }

  const handleEstimateTokens = async () => {
    try {
      const outputText = `${reasoningOutput || ''}${streamOutput || ''}`.trim()
      const result = await ai?.tokens?.estimate({
        model: selectedModel || undefined,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        outputText: outputText.length > 0 ? outputText : undefined
      })
      setTokenEstimate(JSON.stringify(result, null, 2))
    } catch (err: any) {
      notification?.show?.(err?.message || 'Token 估算失败', 'error')
    }
  }

  const handlePickFile = async () => {
    if (dialog?.showOpenDialog) {
      const paths = await dialog.showOpenDialog({ properties: ['openFile'] })
      if (paths?.[0]) {
        const fakeFile = { path: paths[0], name: paths[0].split('/').pop() || 'file' } as any
        await handleUploadAttachment(fakeFile)
      }
      return
    }
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await handleUploadAttachment(file)
    event.target.value = ''
  }

  const handleUploadAttachment = async (file: File) => {
    try {
      const path = (file as any).path
      if (!path) {
        notification?.show?.('无法读取文件路径，请使用系统选择文件', 'error')
        return
      }
      const mimeType = guessMimeType(file)
      const result = await ai?.attachments?.upload({
        filePath: path,
        mimeType,
        purpose: attachmentPurpose
      })
      if (result?.attachmentId) {
        setAttachments((prev) => [...prev, result])
        if (mimeType.startsWith('image/')) {
          setSelectedImageAttachment(result.attachmentId)
        }
        notification?.show?.('附件已上传', 'success')
      }
    } catch (err: any) {
      notification?.show?.(err?.message || '附件上传失败', 'error')
    }
  }

  const handleAttachmentInfo = async (id: string) => {
    try {
      const info = await ai?.attachments?.get(id)
      setAttachmentInfo(JSON.stringify(info, null, 2))
    } catch (err: any) {
      notification?.show?.(err?.message || '获取附件信息失败', 'error')
    }
  }

  const handleAttachmentUploadToProvider = async (id: string) => {
    if (!selectedModel && !providerOverride) {
      notification?.show?.('请先选择模型或填写 Provider ID', 'warning')
      return
    }
    try {
      const result = await ai?.attachments?.uploadToProvider({
        attachmentId: id,
        model: selectedModel || undefined,
        providerId: providerOverride || undefined,
        purpose: providerUploadPurpose || undefined
      })
      setProviderUploadInfo(JSON.stringify(result, null, 2))
      notification?.show?.('已上传到 Provider', 'success')
    } catch (err: any) {
      console.error('[ai-api-test] uploadToProvider failed', err)
      setProviderUploadInfo(String(err?.message || err || '上传到 Provider 失败'))
    }
  }

  const handleAttachmentDelete = async (id: string) => {
    try {
      await ai?.attachments?.delete(id)
      setAttachments((prev) => prev.filter((item) => item.attachmentId !== id))
      notification?.show?.('附件已删除', 'success')
    } catch (err: any) {
      notification?.show?.(err?.message || '删除附件失败', 'error')
    }
  }

  const handleImageGenerate = async () => {
    const model = imageGenModel || selectedModel
    if (!model) {
      notification?.show?.('请先选择图片模型或上方全局模型', 'warning')
      return
    }
    setIsImageGenerating(true)
    setImageGenProgress('开始生成图片...')
    startImageProgressTimer()
    setImageGenPreviewImages([])
    setGeneratedImages([])
    try {
      const input = {
        model,
        prompt: imageGenPrompt,
        size: imageGenSize,
        count: Number(imageGenCount)
      }
      const generateStream = ai?.images?.generateStream
      const result = typeof generateStream === 'function'
        ? await (() => {
          const request = generateStream(input, (chunk: any) => {
            if (!chunk || typeof chunk !== 'object') return
            if (chunk.type === 'status') {
              if (chunk.message) {
                setImageGenProgress(chunk.message)
              }
              return
            }
            if (chunk.type === 'preview' && chunk.image) {
              setImageGenPreviewImages((prev) => {
                const next = [...prev]
                const index = typeof chunk.index === 'number' && chunk.index >= 0 ? chunk.index : next.length
                next[index] = chunk.image
                return next
              })
              const received = Number(chunk.received || 0)
              const total = Number(chunk.total || 0)
              if (received > 0 && total > 0) {
                setImageGenProgress(`生成中... 已收到 ${received}/${total} 个阶段预览`)
              } else {
                setImageGenProgress('生成中... 正在返回阶段预览')
              }
            }
          })
          imageGenerateRequestRef.current = request
          return request
        })()
        : await ai?.images?.generate(input)
      const list = result?.images || []
      setGeneratedImages(list)
      notification?.show?.(`生成完成，返回 ${list.length} 张`, 'success')
    } catch (err: any) {
      notification?.show?.(err?.message || '图片生成失败', 'error')
    } finally {
      imageGenerateRequestRef.current = null
      setIsImageGenerating(false)
      clearImageProgressTimer()
    }
  }

  const handleImageGenerateAbort = () => {
    imageGenerateRequestRef.current?.abort?.()
    setIsImageGenerating(false)
    setImageGenProgress('已取消图片生成')
    clearImageProgressTimer()
  }

  const handleImageEdit = async () => {
    const model = imageEditModel || selectedModel
    if (!model) {
      notification?.show?.('请先选择图片模型或上方全局模型', 'warning')
      return
    }
    if (!selectedImageAttachment) {
      notification?.show?.('请选择图片附件', 'warning')
      return
    }
    try {
      const result = await ai?.images?.edit({
        model,
        imageAttachmentId: selectedImageAttachment,
        prompt: imageEditPrompt
      })
      const list = result?.images || []
      setEditedImages(list)
      notification?.show?.(`编辑完成，返回 ${list.length} 张`, 'success')
    } catch (err: any) {
      notification?.show?.(err?.message || '图片编辑失败', 'error')
    }
  }

  const handleTestConnectionStream = async () => {
    if (!selectedModel) {
      notification?.show?.('请先选择模型', 'warning')
      return
    }
    setConnectionStream('')
    setConnectionReasoning('')
    try {
      const result = await ai?.testConnectionStream?.(
        {
          model: selectedModel
        },
        (chunk: any) => {
          if (chunk?.type === 'reasoning' && chunk?.text) {
            setConnectionReasoning((prev) => prev + chunk.text)
            return
          }
          if (chunk?.text) {
            setConnectionStream((prev) => prev + chunk.text)
          }
        }
      )
      if (result?.reasoning) {
        setConnectionReasoning(result.reasoning)
      }
      if (!connectionStream) {
        if (result?.message) {
          setConnectionStream(`连接成功：${result.message}`)
        } else {
          setConnectionStream('连接成功：ok')
        }
      }
    } catch (err: any) {
      setConnectionStream(err?.message || '流式连接测试失败')
    }
  }

  const maskSettings = (value: any) => {
    if (!value || typeof value !== 'object') return value
    const next = Array.isArray(value) ? [...value] : { ...value }
    if (Array.isArray(next.providers)) {
      next.providers = next.providers.map((provider: any) => ({
        ...provider,
        apiKey: provider.apiKey ? '****' : provider.apiKey
      }))
    }
    return next
  }

  const handleLoadSettings = async () => {
    try {
      const settings = await ai?.settings?.get()
      setSettingsJson(JSON.stringify(maskSettings(settings), null, 2))
    } catch (err: any) {
      notification?.show?.(err?.message || '读取设置失败', 'error')
    }
  }

  const handleUpdateSettings = async () => {
    try {
      const settings = await ai?.settings?.update({})
      setSettingsJson(JSON.stringify(maskSettings(settings), null, 2))
      notification?.show?.('已更新设置 (no-op)', 'success')
    } catch (err: any) {
      notification?.show?.(err?.message || '更新设置失败', 'error')
    }
  }

  const requireMcpServerId = () => {
    const serverId = selectedMcpServerId || mcpServers[0]?.id
    if (!serverId) {
      notification?.show?.('请先选择 MCP 服务器', 'warning')
      return ''
    }
    return serverId
  }

  const handleMcpCheckServer = async () => {
    try {
      const serverId = requireMcpServerId()
      if (!serverId) return
      const check = await ai?.mcp?.checkServer?.(serverId)
      setMcpCheckResult(JSON.stringify(check || { ok: false, message: '无返回结果' }, null, 2))
    } catch (err: any) {
      setMcpCheckResult(err?.message || '检查失败')
    }
  }

  const handleMcpListTools = async () => {
    try {
      const serverId = requireMcpServerId()
      if (!serverId) return
      const tools = await ai?.mcp?.listTools?.(serverId)
      setMcpToolsJson(JSON.stringify(tools || [], null, 2))
    } catch (err: any) {
      setMcpToolsJson(err?.message || '读取工具失败')
    }
  }

  const handleMcpLoadLogs = async () => {
    try {
      const serverId = requireMcpServerId()
      if (!serverId) return
      const logs = await ai?.mcp?.getLogs?.(serverId)
      setMcpLogsJson(JSON.stringify(logs || [], null, 2))
    } catch (err: any) {
      setMcpLogsJson(err?.message || '读取日志失败')
    }
  }

  const handleMcpServerLifecycle = async (action: 'activate' | 'deactivate' | 'restart') => {
    try {
      const serverId = requireMcpServerId()
      if (!serverId) return
      const api = ai?.mcp
      if (!api) {
        notification?.show?.('当前版本未暴露 ai.mcp API', 'warning')
        return
      }
      if (action === 'activate') {
        await api.activateServer?.(serverId)
      } else if (action === 'deactivate') {
        await api.deactivateServer?.(serverId)
      } else {
        await api.restartServer?.(serverId)
      }
      await loadMcpServers()
      notification?.show?.(`MCP 服务器已${action === 'activate' ? '激活' : action === 'deactivate' ? '停用' : '重启'}`, 'success')
    } catch (err: any) {
      notification?.show?.(err?.message || 'MCP 服务器操作失败', 'error')
    }
  }

  const handleMcpCall = async () => {
    if (!selectedModel) {
      notification?.show?.('请先选择模型', 'warning')
      return
    }
    const serverId = selectedMcpServerId || mcpServers[0]?.id
    if (mcpMode === 'manual' && !serverId) {
      notification?.show?.('manual 模式下请先选择 MCP 服务器', 'warning')
      return
    }

    setMcpCallOutput('')
    setMcpCallResult('')
    setIsMcpCalling(true)
    mcpCallIdRef.current = null
    mcpReasoningOpenedRef.current = false
    const currentSession = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    mcpCallSessionRef.current = currentSession
    console.info('[ai-api-test][mcp] call start', {
      model: selectedModel,
      mode: mcpMode,
      selectedMcpServerId: serverId || null
    })

    const append = (text: string) => {
      if (!text) return
      setMcpCallOutput((prev) => prev + text)
    }

    try {
      const call = ai?.call
      if (typeof call !== 'function') {
        throw new Error('当前版本未暴露 ai.call API')
      }
      const mcpSelection = mcpMode === 'off'
        ? { mode: 'off' as const }
        : {
          mode: mcpMode,
          serverIds: mcpMode === 'manual' && serverId ? [serverId] : undefined
        }
      let capabilityDebugLogged = false

      const request = call(
        {
          model: selectedModel,
          messages: [
            { role: 'system', content: '你是一个 MCP 工具调用测试助手。' },
            { role: 'user', content: mcpPrompt }
          ],
          mcp: mcpSelection,
          toolContext: { pluginName: 'ai-api-test' },
          maxToolSteps: 20
        },
        (chunk: any) => {
          if (mcpCallSessionRef.current !== currentSession) return
          console.info('[ai-api-test][mcp] stream chunk', chunk)
          if (chunk?.__callId && !mcpCallIdRef.current) {
            mcpCallIdRef.current = chunk.__callId
          } else if (chunk?.__requestId && !mcpCallIdRef.current) {
            mcpCallIdRef.current = chunk.__requestId
          }
          capturePolicyDebug('mcp-call', 'chunk', chunk)
          if (!capabilityDebugLogged && chunk?.capability_debug) {
            capabilityDebugLogged = true
            const selectedSkills = Array.isArray(chunk.capability_debug?.selectedSkills)
              ? chunk.capability_debug.selectedSkills
              : []
            append(`\n[调试] capability_debug.selectedSkills=${JSON.stringify(selectedSkills)}\n`)
          }
          if (chunk?.chunkType === 'meta') {
            return
          }
          if (chunk?.chunkType === 'error') {
            append(`\n[错误] ${chunk?.error?.message || '流式错误'}\n`)
            return
          }
          // 处理思考内容：只在开始时显示前缀
          const isReasoningChunk = chunk?.chunkType === 'reasoning' || !!chunk?.reasoning_content
          if (isReasoningChunk) {
            if (!mcpReasoningOpenedRef.current) {
              append('\n[思考] ')
              mcpReasoningOpenedRef.current = true
            }
            append(chunk.reasoning_content)
          } else if (mcpReasoningOpenedRef.current && chunk?.chunkType !== 'reasoning') {
            append('\n')
            mcpReasoningOpenedRef.current = false
          }
          if (chunk?.chunkType === 'tool-call' || chunk?.tool_call?.name) {
            const toolName = String(chunk?.tool_call?.name || '[unknown-tool]')
            const argsText = toPreview(chunk?.tool_call?.args)
            append(`\n[调用工具] ${toolName}${argsText ? ` args=${argsText}` : ''}\n`)
          }
          if (chunk?.chunkType === 'tool-result' || chunk?.tool_result?.name) {
            const toolName = String(chunk?.tool_result?.name || '[unknown-tool]')
            const resultText = toPreview(chunk?.tool_result?.result)
            append(`\n[工具结果] ${toolName}${resultText ? ` => ${resultText}` : ''}\n`)
          }
          const text = extractText(chunk?.content)
          if (text) {
            append(text)
          }
        }
      )
      if (!request || typeof (request as any).then !== 'function') {
        throw new Error('ai.call 未返回 Promise，请检查调用桥接是否正常')
      }
      mcpRequestRef.current = request
      if ((request as any)?.requestId && !mcpCallIdRef.current) {
        mcpCallIdRef.current = (request as any).requestId
      }
      const result = await request
      if (mcpCallSessionRef.current !== currentSession) {
        return
      }
      const finalText = extractText(result?.content)
      if (finalText) {
        append(`\n${finalText}`)
      }
      capturePolicyDebug('mcp-call', 'final', result)
      setMcpCallResult(JSON.stringify(result, null, 2))
      console.info('[ai-api-test][mcp] call done', result)
      notification?.show?.('MCP 调用完成', 'success')
    } catch (err: any) {
      if (mcpCallSessionRef.current !== currentSession) {
        return
      }
      console.error('[ai-api-test][mcp] call failed', err)
      setMcpCallResult(err?.message || 'MCP 调用失败')
    } finally {
      if (mcpCallSessionRef.current !== currentSession) {
        return
      }
      setIsMcpCalling(false)
      mcpRequestRef.current = null
      mcpCallIdRef.current = null
      mcpCallSessionRef.current = ''
    }
  }

  const handleMcpAbort = async () => {
    try {
      mcpCallSessionRef.current = ''
      if (mcpRequestRef.current?.abort) {
        mcpRequestRef.current.abort()
        mcpRequestRef.current = null
        mcpCallIdRef.current = null
        setIsMcpCalling(false)
        notification?.show?.('已停止 MCP 调用', 'warning')
        return
      }
      const callId = mcpCallIdRef.current
      if (callId && ai?.mcp?.abort) {
        await ai.mcp.abort(callId)
        mcpRequestRef.current = null
        mcpCallIdRef.current = null
        setIsMcpCalling(false)
        notification?.show?.('已停止 MCP 调用', 'warning')
        return
      }
      if (callId && ai?.abort) {
        await ai.abort(callId)
        mcpRequestRef.current = null
        mcpCallIdRef.current = null
        setIsMcpCalling(false)
        notification?.show?.('已停止 MCP 调用', 'warning')
        return
      }
      notification?.show?.('当前没有可停止的 MCP 请求', 'info')
    } catch (err: any) {
      notification?.show?.(err?.message || '停止 MCP 调用失败', 'error')
    }
  }

  const buildSkillSelection = (): { mode: SkillMode; skillIds?: string[] } => {
    if (skillsMode === 'off') return { mode: 'off' }
    if (skillsMode === 'manual') return { mode: 'manual', skillIds: selectedSkillIds }
    return { mode: 'auto' }
  }

  const toggleSkillSelected = (skillId: string) => {
    setSelectedSkillIds((prev) => {
      if (prev.includes(skillId)) {
        return prev.filter((id) => id !== skillId)
      }
      return [...prev, skillId]
    })
  }

  const handleSkillsPreview = async () => {
    try {
      const preview = ai?.skills?.preview
      if (typeof preview !== 'function') {
        notification?.show?.('当前版本未暴露 ai.skills.preview API', 'warning')
        return
      }
      const selection = buildSkillSelection()
      const result = await preview({
        option: {
          model: selectedModel || undefined,
          messages: [{ role: 'user', content: skillsPrompt }],
          skills: selection
        },
        skillIds: selection.mode === 'manual' ? selection.skillIds : undefined,
        prompt: skillsPrompt
      })
      setSkillsPreviewJson(JSON.stringify(result, null, 2))
    } catch (err: any) {
      setSkillsPreviewJson(err?.message || 'Skills 预览失败')
    }
  }

  const handleSkillsResolve = async () => {
    try {
      const resolveSkills = ai?.skills?.resolve
      if (typeof resolveSkills !== 'function') {
        notification?.show?.('当前版本未暴露 ai.skills.resolve API', 'warning')
        return
      }
      const result = await resolveSkills({
        model: selectedModel || undefined,
        messages: [{ role: 'user', content: skillsPrompt }],
        skills: buildSkillSelection()
      })
      setSkillsResolveJson(JSON.stringify(result, null, 2))
    } catch (err: any) {
      setSkillsResolveJson(err?.message || 'Skills resolve 失败')
    }
  }

  const handleSkillsCall = async () => {
    if (!selectedModel) {
      notification?.show?.('请先选择模型', 'warning')
      return
    }
    if (skillsMode === 'manual' && selectedSkillIds.length === 0) {
      notification?.show?.('manual 模式下请至少勾选一个 Skill', 'warning')
      return
    }
    setSkillsCallOutput('')
    setSkillsCallResult('')
    setSkillsCapabilityDebugJson('')
    setIsSkillsCalling(true)
    skillsRequestIdRef.current = null
    skillsReasoningOpenedRef.current = false
    const append = (text: string) => {
      if (!text) return
      setSkillsCallOutput((prev) => prev + text)
    }
    const applyCapabilityDebug = (payload: any, stage: 'chunk' | 'final') => {
      if (!payload || typeof payload !== 'object') return
      const normalizeList = (value: unknown) => Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean)
        : []
      const normalized = {
        stage,
        requested: normalizeList(payload.requested),
        allowed: normalizeList(payload.allowed),
        denied: normalizeList(payload.denied),
        reasons: normalizeList(payload.reasons),
        selectedSkills: Array.isArray(payload.selectedSkills) ? payload.selectedSkills : []
      }
      setSkillsCapabilityDebugJson(JSON.stringify(normalized, null, 2))
    }

    try {
      const request = ai?.call(
        {
          model: selectedModel,
          messages: [
            { role: 'system', content: '你是一个 Skills 调用测试助手。' },
            { role: 'user', content: skillsPrompt }
          ],
          skills: buildSkillSelection(),
          maxToolSteps: 100
        },
        (chunk: any) => {
          if (chunk?.__requestId && !skillsRequestIdRef.current) {
            skillsRequestIdRef.current = chunk.__requestId
          }
          capturePolicyDebug('skills-call', 'chunk', chunk)
          if (chunk?.capability_debug) {
            applyCapabilityDebug(chunk.capability_debug, 'chunk')
          }
          if (chunk?.chunkType === 'meta') {
            return
          }
          if (chunk?.chunkType === 'error') {
            append(`\n[错误] ${chunk?.error?.message || '流式错误'}\n`)
            return
          }
          // 处理思考内容：只在开始时显示前缀
          const isReasoningChunk = chunk?.chunkType === 'reasoning' || !!chunk?.reasoning_content
          if (isReasoningChunk) {
            if (!skillsReasoningOpenedRef.current) {
              append('\n[思考] ')
              skillsReasoningOpenedRef.current = true
            }
            append(chunk.reasoning_content)
          } else if (skillsReasoningOpenedRef.current && chunk?.chunkType !== 'reasoning') {
            append('\n')
            skillsReasoningOpenedRef.current = false
          }
          const text = extractText(chunk?.content)
          if (text) append(text)
        }
      )
      skillsRequestRef.current = request
      if ((request as any)?.requestId && !skillsRequestIdRef.current) {
        skillsRequestIdRef.current = (request as any).requestId
      }
      const result = await request
      const finalText = extractText(result?.content)
      if (finalText) append(`\n${finalText}`)
      capturePolicyDebug('skills-call', 'final', result)
      if (result?.capability_debug) {
        applyCapabilityDebug(result.capability_debug, 'final')
      }
      setSkillsCallResult(JSON.stringify(result, null, 2))
      notification?.show?.('Skills 调用完成', 'success')
    } catch (err: any) {
      setSkillsCallResult(err?.message || 'Skills 调用失败')
    } finally {
      skillsRequestRef.current = null
      skillsRequestIdRef.current = null
      setIsSkillsCalling(false)
    }
  }

  const handleSkillsAbort = async () => {
    try {
      if (skillsRequestRef.current?.abort) {
        skillsRequestRef.current.abort()
        skillsRequestRef.current = null
        skillsRequestIdRef.current = null
        setIsSkillsCalling(false)
        notification?.show?.('已停止 Skills 调用', 'warning')
        return
      }
      const requestId = skillsRequestIdRef.current
      if (requestId && ai?.abort) {
        await ai.abort(requestId)
        skillsRequestRef.current = null
        skillsRequestIdRef.current = null
        setIsSkillsCalling(false)
        notification?.show?.('已停止 Skills 调用', 'warning')
        return
      }
      notification?.show?.('当前没有可停止的 Skills 请求', 'info')
    } catch (err: any) {
      notification?.show?.(err?.message || '停止 Skills 调用失败', 'error')
    }
  }

  const handleToolCall = async () => {
    try {
      const result = await host?.call?.('runToolCall', {
        model: selectedModel || undefined,
        prompt: toolPrompt
      })
      const payload = result?.data || result
      capturePolicyDebug('host-tool-call', 'final', payload)
      setToolResult(JSON.stringify(payload, null, 2))
    } catch (err: any) {
      setToolResult(err?.message || '工具调用失败')
    }
  }

  const handleToolCallStream = async () => {
    if (!selectedModel) {
      notification?.show?.('请先选择模型', 'warning')
      return
    }
    setToolStreamOutput('')
    toolStreamBufferRef.current = ''
    toolReasoningOpenedRef.current = false
    setToolResult('')
    setIsToolStreaming(true)

    const appendToolStream = (text: string) => {
      if (!text) return
      toolStreamBufferRef.current += text
      setToolStreamOutput(toolStreamBufferRef.current)
    }

    try {
      // 定义工具
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'sumNumbers',
            description: '计算两数之和',
            parameters: {
              type: 'object',
              properties: {
                a: { type: 'number', description: '第一个数' },
                b: { type: 'number', description: '第二个数' }
              },
              required: ['a', 'b']
            }
          }
        },
        {
          type: 'function' as const,
          function: {
            name: 'getSystemInfo',
            description: '获取系统信息',
            parameters: {
              type: 'object',
              properties: {}
            }
          }
        }
      ]

      // 调用带工具的流式 API
      const result = await ai?.call(
        {
          model: selectedModel,
          messages: [
            { role: 'system', content: '你是一个助手，可以调用工具来完成任务。' },
            { role: 'user', content: toolPrompt }
          ],
          tools,
          toolContext: { pluginName: 'ai-api-test' },
          maxToolSteps: 20
        },
        (chunk: any) => {
          console.log('[ai-api-test] stream chunk', chunk)
          capturePolicyDebug('tool-stream', 'chunk', chunk)
          if (chunk?.chunkType === 'end') {
            return
          }
          if (chunk?.chunkType === 'error') {
            appendToolStream(`\n[错误] ${chunk?.error?.message || '流式错误'}\n`)
            return
          }
          const isReasoningChunk = chunk?.chunkType === 'reasoning' || !!chunk?.reasoning_content
          if (isReasoningChunk) {
            if (!toolReasoningOpenedRef.current) {
              appendToolStream('\n[思考] ')
              toolReasoningOpenedRef.current = true
            }
            appendToolStream(chunk.reasoning_content)
          } else if (toolReasoningOpenedRef.current && chunk?.chunkType !== 'reasoning') {
            appendToolStream('\n')
            toolReasoningOpenedRef.current = false
          }
          if (chunk?.chunkType === 'tool-call' || chunk?.tool_call?.name) {
            const argsText = toPreview(chunk?.tool_call?.args)
            appendToolStream(`\n[调用工具] ${chunk.tool_call.name}${argsText ? ` args=${argsText}` : ''}\n`)
          }
          if (chunk?.chunkType === 'tool-result' || chunk?.tool_result?.name) {
            const resultText = toPreview(chunk?.tool_result?.result)
            appendToolStream(`\n[工具结果] ${chunk.tool_result.name}${resultText ? ` => ${resultText}` : ''}\n`)
          }
          const text = extractText(chunk?.content)
          if (text) {
            appendToolStream(text)
          }
        }
      )

      const finalText = extractText(result?.content)
      if (finalText) {
        if (!toolStreamBufferRef.current) {
          toolStreamBufferRef.current = finalText
          setToolStreamOutput(finalText)
        } else if (!toolStreamBufferRef.current.includes(finalText)) {
          appendToolStream(`\n${finalText}`)
        }
      }
      capturePolicyDebug('tool-stream', 'final', result)
      setToolResult(JSON.stringify(result, null, 2))
      setIsToolStreaming(false)
      notification?.show?.('流式工具调用完成', 'success')
    } catch (err: any) {
      setToolResult(err?.message || '流式工具调用失败')
      setIsToolStreaming(false)
    }
  }

  const imageAttachmentOptions = useMemo(() => {
    return attachments.filter((item) => item.mimeType?.startsWith('image/'))
  }, [attachments])

  const selectedModelInfo = useMemo(() => {
    return models.find((item) => item.id === selectedModel)
  }, [models, selectedModel])

  const selectedMcpServer = useMemo(() => {
    return mcpServers.find((item) => item.id === selectedMcpServerId)
  }, [mcpServers, selectedMcpServerId])

  const selectedCapabilities = useMemo(() => {
    const caps = selectedModelInfo?.capabilities || []
    return caps
      .filter((cap) => cap?.type && cap.isUserSelected !== false)
      .map((cap) => cap.type)
  }, [selectedModelInfo])
  const policyDebugJson = useMemo(() => {
    if (policyDebugEntries.length === 0) return ''
    return JSON.stringify(policyDebugEntries, null, 2)
  }, [policyDebugEntries])

  return (
    <div className="app">
      <div className="header">
        <div>
          <div className="title">AI API 测试控制台</div>
          <div className="subtitle">覆盖所有 AI API 功能，默认仅使用流式输出</div>
        </div>
        <button className="btn-secondary" onClick={loadModels}>
          <Loader2 size={16} className="icon" />
          重新加载模型
        </button>
      </div>

      <div className="grid">
        <section className="card">
          <div className="card-title">模型与连接</div>
          <div className="field">
            <label>可用模型（来自全局 AI 设置）</label>
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              <option value="">请选择模型</option>
              {models.map((model) => {
                const providerId = model.id.includes(':') ? model.id.split(':', 2)[0] : 'unknown'
                const providerText = model.providerLabel || providerId
                const labelText = model.label || model.id
                return (
                  <option key={model.id} value={model.id}>
                    {providerText} · {labelText}
                  </option>
                )
              })}
            </select>
          </div>
          <div className="actions">
            <button className="btn-ghost" onClick={handleTestConnectionStream}>
              流式连接测试
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            能力：{selectedCapabilities.length > 0 ? selectedCapabilities.join(' / ') : '未标记'}
          </div>
          <textarea className="output" value={modelsJson} readOnly placeholder="模型列表" />
          <div className="split">
            <div className="field">
              <label>连接测试 - 思考过程</label>
              <textarea className="output" value={connectionReasoning} readOnly placeholder="reasoning..." />
            </div>
            <div className="field">
              <label>连接测试 - 输出</label>
              <textarea className="output" value={connectionStream} readOnly placeholder="流式连接测试输出" />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-title">流式对话 (支持思考过程)</div>
          <div className="field">
            <label>System Prompt</label>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} />
          </div>
          <div className="field">
            <label>User Prompt</label>
            <textarea value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} rows={4} />
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={startStream} disabled={isStreaming}>
              <Play size={16} className="icon" />
              开始流式输出
            </button>
            <button className="btn-secondary" onClick={stopStream} disabled={!isStreaming}>
              停止
            </button>
            <button className="btn-ghost" onClick={handleEstimateTokens}>
              估算 Token
            </button>
          </div>
          <div className="split">
            <div className="field">
              <label>思考过程</label>
              <textarea className="output" value={reasoningOutput} readOnly placeholder="thinking..." />
            </div>
            <div className="field">
              <label>回答内容</label>
              <textarea className="output" value={streamOutput} readOnly placeholder="streaming..." />
            </div>
          </div>
          <div className="split">
            <textarea className="output" value={tokenEstimate} readOnly placeholder="Token 估算结果" />
            <textarea className="output" value={tokenActual} readOnly placeholder="Token 实际结果" />
          </div>
        </section>

        <section className="card">
          <div className="card-title">工具调用 (Backend)</div>
          <div className="field">
            <label>工具提示词</label>
            <textarea value={toolPrompt} onChange={(e) => setToolPrompt(e.target.value)} rows={3} />
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={handleToolCall} disabled={isToolStreaming}>
              触发工具调用
            </button>
            <button className="btn-secondary" onClick={handleToolCallStream} disabled={isToolStreaming}>
              <Play size={16} className="icon" />
              流式工具调用
            </button>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            两种模式都支持工具调用（sumNumbers、getSystemInfo），流式模式可以实时看到输出
          </div>
          <div className="field">
            <label>流式输出</label>
            <textarea className="output" value={toolStreamOutput} readOnly placeholder="流式输出内容..." />
          </div>
          <div className="field">
            <label>最终结果</label>
            <textarea className="output" value={toolResult} readOnly placeholder="工具调用结果" />
          </div>
        </section>

        <section className="card">
          <div className="card-title">MCP 测试 (Renderer)</div>
          <div className="split">
            <div className="field">
              <label>MCP 服务器</label>
              <select value={selectedMcpServerId} onChange={(e) => setSelectedMcpServerId(e.target.value)}>
                <option value="">请选择服务器</option>
                {mcpServers.map((server) => (
                  <option key={server.id} value={server.id}>
                    [{server.isActive ? 'on' : 'off'}] {server.name} ({server.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>MCP 工具选择模式</label>
              <select value={mcpMode} onChange={(e) => setMcpMode(e.target.value as 'off' | 'manual' | 'auto')}>
                <option value="off">off（禁用 MCP）</option>
                <option value="manual">manual（仅所选服务器）</option>
                <option value="auto">auto（自动选择）</option>
              </select>
            </div>
          </div>
          <div className="actions">
            <button className="btn-secondary" onClick={loadMcpServers}>
              刷新服务器
            </button>
            <button className="btn-ghost" onClick={handleMcpCheckServer}>
              检查
            </button>
            <button className="btn-ghost" onClick={() => handleMcpServerLifecycle('activate')}>
              激活
            </button>
            <button className="btn-ghost" onClick={() => handleMcpServerLifecycle('deactivate')}>
              停用
            </button>
            <button className="btn-ghost" onClick={() => handleMcpServerLifecycle('restart')}>
              重启
            </button>
            <button className="btn-ghost" onClick={handleMcpListTools}>
              读取工具
            </button>
            <button className="btn-ghost" onClick={handleMcpLoadLogs}>
              读取日志
            </button>
          </div>
          {selectedMcpServer ? (
            <div className="text-xs text-slate-500">
              当前服务器：{selectedMcpServer.name} / {selectedMcpServer.type} / {selectedMcpServer.isActive ? '已激活' : '未激活'}
            </div>
          ) : (
            <div className="text-xs text-slate-500">未选择服务器。manual 模式下将无法调用 MCP。</div>
          )}
          <div className="field">
            <label>MCP 调用提示词</label>
            <textarea value={mcpPrompt} onChange={(e) => setMcpPrompt(e.target.value)} rows={3} />
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={handleMcpCall} disabled={isMcpCalling}>
              <Play size={16} className="icon" />
              开始 MCP 调用
            </button>
            <button className="btn-secondary" onClick={handleMcpAbort} disabled={!isMcpCalling}>
              停止
            </button>
          </div>
          <div className="split">
            <div className="field">
              <label>检查结果</label>
              <textarea className="output" value={mcpCheckResult} readOnly placeholder="checkServer 结果" />
            </div>
            <div className="field">
              <label>MCP 调用流式输出</label>
              <textarea className="output" value={mcpCallOutput} readOnly placeholder="MCP 流式输出..." />
            </div>
          </div>
          <div className="field">
            <label>MCP 调用最终结果</label>
            <textarea className="output" value={mcpCallResult} readOnly placeholder="MCP 调用结果" />
          </div>
          <div className="split">
            <div className="field">
              <label>服务器工具</label>
              <textarea className="output" value={mcpToolsJson} readOnly placeholder="listTools 结果" />
            </div>
            <div className="field">
              <label>服务器日志</label>
              <textarea className="output" value={mcpLogsJson} readOnly placeholder="getLogs 结果" />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-title">Skills 测试 (Renderer)</div>
          <div className="split">
            <div className="field">
              <label>Skills 选择模式</label>
              <select value={skillsMode} onChange={(e) => setSkillsMode(e.target.value as SkillMode)}>
                <option value="off">off（禁用 Skills）</option>
                <option value="manual">manual（手动选择）</option>
                <option value="auto">auto（自动选择）</option>
              </select>
            </div>
            <div className="field">
              <label>已选 Skill 数量</label>
              <input value={String(selectedSkillIds.length)} readOnly />
            </div>
          </div>
          <div className="actions">
            <button className="btn-secondary" onClick={loadSkills}>
              刷新 Skills
            </button>
            <button className="btn-ghost" onClick={handleSkillsPreview}>
              预览合成
            </button>
            <button className="btn-ghost" onClick={handleSkillsResolve}>
              解析选择
            </button>
          </div>
          <div className="list">
            {skillsList.length === 0 && <div className="empty">暂无可用 Skills 或当前 API 未暴露</div>}
            {skillsList.map((skill) => {
              const skillName = skill.descriptor?.name || skill.id
              const checked = selectedSkillIds.includes(skill.id)
              const skillTag = skill.origin === 'system' ? 'System' : 'App'
              return (
                <label className="list-item" key={skill.id}>
                  <div>
                    <div className="list-title">{skillName}</div>
                    <div className="list-sub">{skill.id} · {skillTag} · {skill.enabled ? '启用' : '停用'}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={skillsMode !== 'manual'}
                    onChange={() => toggleSkillSelected(skill.id)}
                  />
                </label>
              )
            })}
          </div>
          <div className="field">
            <label>Skills 调用提示词</label>
            <textarea value={skillsPrompt} onChange={(e) => setSkillsPrompt(e.target.value)} rows={3} />
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={handleSkillsCall} disabled={isSkillsCalling}>
              <Play size={16} className="icon" />
              开始 Skills 调用
            </button>
            <button className="btn-secondary" onClick={handleSkillsAbort} disabled={!isSkillsCalling}>
              停止
            </button>
          </div>
          <div className="split">
            <div className="field">
              <label>Skills 调用流式输出</label>
              <textarea className="output" value={skillsCallOutput} readOnly placeholder="Skills 流式输出..." />
            </div>
            <div className="field">
              <label>Skills 调用最终结果</label>
              <textarea className="output" value={skillsCallResult} readOnly placeholder="Skills 调用结果" />
            </div>
          </div>
          <div className="field">
            <label>Capability 调试面板（实时）</label>
            <textarea
              className="output"
              value={skillsCapabilityDebugJson}
              readOnly
              placeholder="requested / allowed / denied / reasons 将显示在这里"
            />
          </div>
          <div className="split">
            <div className="field">
              <label>Skills Preview</label>
              <textarea className="output" value={skillsPreviewJson} readOnly placeholder="skills.preview 结果" />
            </div>
            <div className="field">
              <label>Skills Resolve</label>
              <textarea className="output" value={skillsResolveJson} readOnly placeholder="skills.resolve 结果" />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-title">策略可视化 (ai.call)</div>
          <div className="actions">
            <button className="btn-ghost" onClick={() => setPolicyDebugEntries([])}>
              清空记录
            </button>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            展示最近 20 次 ai.call 的最终生效策略（skills / mcp / toolContext 合并结果）。
          </div>
          <div className="field">
            <label>Policy Debug</label>
            <textarea
              className="output"
              value={policyDebugJson}
              readOnly
              placeholder="等待 ai.call 返回 policy_debug..."
            />
          </div>
        </section>

        <section className="card">
          <div className="card-title">附件管理</div>
          <div className="split">
            <div className="field">
              <label>附件用途</label>
              <input value={attachmentPurpose} onChange={(e) => setAttachmentPurpose(e.target.value)} placeholder="vision" />
            </div>
            <div className="field">
              <label>上传附件</label>
              <div className="inline">
                <button className="btn-primary" onClick={handlePickFile}>
                  <PlusCircle size={16} className="icon" />
                  选择文件
                </button>
                <input ref={fileInputRef} type="file" onChange={handleFileChange} hidden />
              </div>
            </div>
          </div>
          <div className="field">
            <label>Provider ID (可选，未填则使用所选模型)</label>
            <input value={providerOverride} onChange={(e) => setProviderOverride(e.target.value)} placeholder="anthropic / google / openai" />
          </div>
          <div className="field">
            <label>Provider 上传用途 (purpose)</label>
            <input value={providerUploadPurpose} onChange={(e) => setProviderUploadPurpose(e.target.value)} placeholder="agent / code-interpreter / batch" />
          </div>
          <div className="list">
            {attachments.length === 0 && <div className="empty">暂无附件</div>}
            {attachments.map((item) => (
              <div className="list-item" key={item.attachmentId}>
                <div>
                  <div className="list-title">{item.filename || item.attachmentId}</div>
                  <div className="list-sub">{item.mimeType} · {item.size} bytes</div>
                </div>
                <div className="actions">
                  <button className="btn-ghost" onClick={() => handleAttachmentUploadToProvider(item.attachmentId)}>
                    上传到 Provider
                  </button>
                  <button className="btn-ghost" onClick={() => handleAttachmentInfo(item.attachmentId)}>
                    信息
                  </button>
                  <button className="btn-secondary" onClick={() => handleAttachmentDelete(item.attachmentId)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
          <textarea className="output" value={attachmentInfo} readOnly placeholder="附件详情" />
          <textarea className="output" value={providerUploadInfo} readOnly placeholder="Provider 文件信息 (fileId / uri)" />
        </section>

        <section className="card">
          <div className="card-title">图片生成</div>
          <div className="field">
            <label>模型</label>
            <select value={imageGenModel} onChange={(e) => setImageGenModel(e.target.value)}>
              <option value="">跟随上方“模型与连接”当前模型</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.providerLabel || model.id.split(':', 2)[0] || 'unknown'} · {model.label || model.id}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>提示词</label>
            <textarea value={imageGenPrompt} onChange={(e) => setImageGenPrompt(e.target.value)} rows={3} />
          </div>
          <div className="split">
            <div className="field">
              <label>尺寸</label>
              <input value={imageGenSize} onChange={(e) => setImageGenSize(e.target.value)} />
            </div>
            <div className="field">
              <label>数量</label>
              <input
                type="number"
                min={1}
                max={4}
                value={imageGenCount}
                onChange={(e) => setImageGenCount(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={handleImageGenerate} disabled={isImageGenerating}>
              <Wand2 size={16} className="icon" />
              {isImageGenerating ? '生成中...' : '生成图片'}
            </button>
            <button className="btn-secondary" onClick={handleImageGenerateAbort} disabled={!isImageGenerating}>
              取消
            </button>
          </div>
          {imageGenProgress ? <div className="list-sub">{imageGenProgress}</div> : null}
          {imageGenPreviewImages.filter(Boolean).length > 0 ? (
            <div className="image-grid">
              {imageGenPreviewImages.filter(Boolean).map((img, index) => (
                <img key={`preview-${index}`} src={toImageSrc(img)} alt={`preview-${index}`} />
              ))}
            </div>
          ) : null}
          <div className="image-grid">
            {generatedImages.map((img, index) => (
              <img key={index} src={toImageSrc(img)} alt={`generated-${index}`} />
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-title">图片编辑</div>
          <div className="field">
            <label>模型</label>
            <select value={imageEditModel} onChange={(e) => setImageEditModel(e.target.value)}>
              <option value="">跟随上方“模型与连接”当前模型</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.providerLabel || model.id.split(':', 2)[0] || 'unknown'} · {model.label || model.id}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>图片附件</label>
            <select value={selectedImageAttachment} onChange={(e) => setSelectedImageAttachment(e.target.value)}>
              <option value="">请选择图片附件</option>
              {imageAttachmentOptions.map((item) => (
                <option key={item.attachmentId} value={item.attachmentId}>
                  {item.filename || item.attachmentId}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>提示词</label>
            <textarea value={imageEditPrompt} onChange={(e) => setImageEditPrompt(e.target.value)} rows={3} />
          </div>
          <button className="btn-primary" onClick={handleImageEdit}>
            <ImageIcon size={16} className="icon" />
            编辑图片
          </button>
          <div className="image-grid">
            {editedImages.map((img, index) => (
              <img key={index} src={toImageSrc(img)} alt={`edited-${index}`} />
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-title">AI 设置 (Renderer)</div>
          <div className="actions">
            <button className="btn-secondary" onClick={handleLoadSettings}>
              读取设置
            </button>
            <button className="btn-ghost" onClick={handleUpdateSettings}>
              更新设置 (no-op)
            </button>
          </div>
          <textarea className="output" value={settingsJson} readOnly placeholder="AI 设置 JSON" />
        </section>
      </div>
    </div>
  )
}
