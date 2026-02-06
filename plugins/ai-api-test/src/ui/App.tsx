import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Wand2, Image as ImageIcon, Play, PlusCircle } from 'lucide-react'
import { useIntools } from './hooks/useIntools'

type AiAttachmentRef = {
  attachmentId: string
  mimeType: string
  size: number
  filename?: string
  purpose?: string
}

type ModelItem = { id: string; label?: string; description?: string; providerLabel?: string; capabilities?: Array<{ type: string; isUserSelected?: boolean }> }

const defaultSystemPrompt = '你是一个专业的 AI API 测试助手。'
const defaultUserPrompt = '请用简短中文说明今天的测试进度，并给一个下一步建议。'

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

export default function App() {
  const { ai, notification, host, dialog } = useIntools('ai-api-test') as any

  const [theme, setTheme] = useState<'light' | 'dark'>('light')
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
  const [imageGenModel, setImageGenModel] = useState('openai:gpt-image-1')
  const [imageGenSize, setImageGenSize] = useState('1024x1024')
  const [imageGenCount, setImageGenCount] = useState(1)
  const [generatedImages, setGeneratedImages] = useState<string[]>([])

  const [imageEditPrompt, setImageEditPrompt] = useState('Add a red scarf')
  const [imageEditModel, setImageEditModel] = useState('openai:gpt-image-1')
  const [selectedImageAttachment, setSelectedImageAttachment] = useState('')
  const [editedImages, setEditedImages] = useState<string[]>([])

  const [videoPrompt, setVideoPrompt] = useState('A drone flying over mountains at sunrise')
  const [videoModel, setVideoModel] = useState('openai:sora-1')
  const [videoDuration, setVideoDuration] = useState(5)
  const [videoSize, setVideoSize] = useState('1280x720')
  const [videoResult, setVideoResult] = useState('')

  const [connectionStream, setConnectionStream] = useState('')
  const [connectionReasoning, setConnectionReasoning] = useState('')

  const [toolPrompt, setToolPrompt] = useState('请先调用 sumNumbers 计算 12 + 30，然后再调用getSystemInfo返回给我系统信息，最后以"计算结果:xx；系统信息:"的格式返回给我')
  const [toolResult, setToolResult] = useState('')
  const [toolStreamOutput, setToolStreamOutput] = useState('')
  const [isToolStreaming, setIsToolStreaming] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const streamRequestRef = useRef<any>(null)
  const streamRequestIdRef = useRef<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.intools?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })
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
      notification?.show?.('模型列表已加载', 'success')
    } catch (err: any) {
      notification?.show?.(err?.message || '模型列表加载失败', 'error')
    }
  }

  useEffect(() => {
    loadModels()
  }, [])

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
    try {
      const result = await ai?.images?.generate({
        model: imageGenModel,
        prompt: imageGenPrompt,
        size: imageGenSize,
        count: Number(imageGenCount)
      })
      setGeneratedImages(result?.images || [])
    } catch (err: any) {
      notification?.show?.(err?.message || '图片生成失败', 'error')
    }
  }

  const handleImageEdit = async () => {
    if (!selectedImageAttachment) {
      notification?.show?.('请选择图片附件', 'warning')
      return
    }
    try {
      const result = await ai?.images?.edit({
        model: imageEditModel,
        imageAttachmentId: selectedImageAttachment,
        prompt: imageEditPrompt
      })
      setEditedImages(result?.images || [])
    } catch (err: any) {
      notification?.show?.(err?.message || '图片编辑失败', 'error')
    }
  }

  const handleVideoGenerate = async () => {
    try {
      await ai?.videos?.generate({
        model: videoModel,
        prompt: videoPrompt,
        duration: Number(videoDuration),
        size: videoSize
      })
      setVideoResult('视频任务提交成功 (如支持)')
    } catch (err: any) {
      setVideoResult(err?.message || '视频生成失败')
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

  const handleToolCall = async () => {
    try {
      const result = await host?.call?.('runToolCall', {
        model: selectedModel || undefined,
        prompt: toolPrompt
      })
      setToolResult(JSON.stringify(result?.data || result, null, 2))
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
    setToolResult('')
    setIsToolStreaming(true)

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
          maxToolSteps: 5
        },
        (chunk: any) => {
          console.log('[ai-api-test] stream chunk', chunk)
          const text = extractText(chunk?.content)
          if (text) {
            setToolStreamOutput((prev) => prev + text)
          }
        }
      )

      const finalText = extractText(result?.content)
      if (finalText) {
        setToolStreamOutput(finalText)
      }
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

  const selectedCapabilities = useMemo(() => {
    const caps = selectedModelInfo?.capabilities || []
    return caps
      .filter((cap) => cap?.type && cap.isUserSelected !== false)
      .map((cap) => cap.type)
  }, [selectedModelInfo])

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
            <input value={imageGenModel} onChange={(e) => setImageGenModel(e.target.value)} />
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
          <button className="btn-primary" onClick={handleImageGenerate}>
            <Wand2 size={16} className="icon" />
            生成图片
          </button>
          <div className="image-grid">
            {generatedImages.map((img, index) => (
              <img key={index} src={`data:image/png;base64,${img}`} alt={`generated-${index}`} />
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-title">图片编辑</div>
          <div className="field">
            <label>模型</label>
            <input value={imageEditModel} onChange={(e) => setImageEditModel(e.target.value)} />
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
              <img key={index} src={`data:image/png;base64,${img}`} alt={`edited-${index}`} />
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-title">视频生成</div>
          <div className="field">
            <label>模型</label>
            <input value={videoModel} onChange={(e) => setVideoModel(e.target.value)} />
          </div>
          <div className="field">
            <label>提示词</label>
            <textarea value={videoPrompt} onChange={(e) => setVideoPrompt(e.target.value)} rows={3} />
          </div>
          <div className="split">
            <div className="field">
              <label>时长 (秒)</label>
              <input type="number" min={1} value={videoDuration} onChange={(e) => setVideoDuration(Number(e.target.value))} />
            </div>
            <div className="field">
              <label>尺寸</label>
              <input value={videoSize} onChange={(e) => setVideoSize(e.target.value)} />
            </div>
          </div>
          <button className="btn-primary" onClick={handleVideoGenerate}>
            生成视频
          </button>
          <textarea className="output" value={videoResult} readOnly placeholder="视频生成结果" />
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
