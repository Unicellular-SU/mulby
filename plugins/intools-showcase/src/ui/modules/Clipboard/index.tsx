import React, { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useIntools, useNotification } from '../../hooks'

type ClipboardFormat = 'text' | 'image' | 'files' | 'empty'

interface ClipboardFile {
    path: string
    name: string
    size: number
    isDirectory: boolean
}

export function ClipboardModule() {
    const { clipboard } = useIntools()
    const notify = useNotification()

    const [format, setFormat] = useState<ClipboardFormat>('empty')
    const [textContent, setTextContent] = useState('')
    const [imageData, setImageData] = useState<string | null>(null)
    const [files, setFiles] = useState<ClipboardFile[]>([])
    const [inputText, setInputText] = useState('')
    const [loading, setLoading] = useState(false)

    const readClipboard = useCallback(async () => {
        setLoading(true)
        try {
            const fmt = await clipboard.getFormat()
            setFormat(fmt || 'empty')

            switch (fmt) {
                case 'text':
                    const text = await clipboard.readText()
                    setTextContent(text || '')
                    setImageData(null)
                    setFiles([])
                    break
                case 'image':
                    const img = await clipboard.readImage()
                    if (img) {
                        // Convert Buffer to base64 data URL
                        const base64 = btoa(
                            new Uint8Array(img).reduce((data, byte) => data + String.fromCharCode(byte), '')
                        )
                        setImageData(`data:image/png;base64,${base64}`)
                    }
                    setTextContent('')
                    setFiles([])
                    break
                case 'files':
                    const fileList = await clipboard.readFiles()
                    setFiles(fileList || [])
                    setTextContent('')
                    setImageData(null)
                    break
                default:
                    setTextContent('')
                    setImageData(null)
                    setFiles([])
            }
        } catch (error) {
            notify.error('读取剪贴板失败')
        } finally {
            setLoading(false)
        }
    }, [clipboard, notify])

    useEffect(() => {
        readClipboard()
    }, [readClipboard])

    const handleWriteText = async () => {
        if (!inputText.trim()) {
            notify.warning('请输入要写入的内容')
            return
        }
        try {
            await clipboard.writeText(inputText)
            notify.success('已写入剪贴板')
            setInputText('')
            readClipboard()
        } catch (error) {
            notify.error('写入失败')
        }
    }

    const handleWriteSampleText = async () => {
        const sampleText = `InTools Showcase - 测试文本
时间: ${new Date().toLocaleString()}
这是一段测试文本，用于演示剪贴板写入功能。`
        try {
            await clipboard.writeText(sampleText)
            notify.success('已写入测试文本')
            readClipboard()
        } catch (error) {
            notify.error('写入失败')
        }
    }

    const handleCopyFromContent = async () => {
        if (format === 'text' && textContent) {
            await clipboard.writeText(textContent)
            notify.success('内容已复制')
        }
    }

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    const getFormatBadge = () => {
        switch (format) {
            case 'text':
                return <StatusBadge status="info">文本</StatusBadge>
            case 'image':
                return <StatusBadge status="success">图片</StatusBadge>
            case 'files':
                return <StatusBadge status="warning">文件</StatusBadge>
            default:
                return <StatusBadge status="error">空</StatusBadge>
        }
    }

    return (
        <div className="main-content">
            <PageHeader
                icon="📋"
                title="剪贴板管理"
                description="读取和写入剪贴板内容"
                actions={<Button onClick={readClipboard} loading={loading}>刷新</Button>}
            />
            <div className="page-content">
                {/* Current Format */}
                <Card title="当前状态" icon="📊">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
                        <div>
                            <span style={{ color: 'var(--text-secondary)', marginRight: 'var(--spacing-sm)' }}>
                                格式:
                            </span>
                            {getFormatBadge()}
                        </div>
                        {format === 'text' && (
                            <div style={{ color: 'var(--text-secondary)' }}>
                                长度: {textContent.length} 字符
                            </div>
                        )}
                        {format === 'files' && (
                            <div style={{ color: 'var(--text-secondary)' }}>
                                数量: {files.length} 个文件
                            </div>
                        )}
                    </div>
                </Card>

                {/* Content Preview */}
                <Card
                    title="内容预览"
                    icon="👁️"
                    actions={
                        format === 'text' && textContent ? (
                            <Button variant="secondary" onClick={handleCopyFromContent}>复制</Button>
                        ) : null
                    }
                >
                    {format === 'empty' && (
                        <div className="empty-state">
                            <div className="empty-icon">📭</div>
                            <div>剪贴板为空</div>
                        </div>
                    )}

                    {format === 'text' && (
                        <CodeBlock>{textContent || '(空文本)'}</CodeBlock>
                    )}

                    {format === 'image' && imageData && (
                        <div className="preview-box">
                            <img src={imageData} alt="剪贴板图片" />
                        </div>
                    )}

                    {format === 'files' && files.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                            {files.map((file, index) => (
                                <div
                                    key={index}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--spacing-sm)',
                                        padding: 'var(--spacing-sm)',
                                        background: 'var(--bg-tertiary)',
                                        borderRadius: 'var(--radius-sm)',
                                    }}
                                >
                                    <span>{file.isDirectory ? '📁' : '📄'}</span>
                                    <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '12px' }}>
                                        {file.name}
                                    </span>
                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>
                                        {formatFileSize(file.size)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                {/* Write Section */}
                <Card title="写入测试" icon="✏️">
                    <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                        <label className="input-label">输入内容</label>
                        <textarea
                            className="textarea"
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            placeholder="输入要写入剪贴板的内容..."
                            rows={3}
                        />
                    </div>
                    <div className="action-bar">
                        <Button onClick={handleWriteText} disabled={!inputText.trim()}>
                            写入剪贴板
                        </Button>
                        <Button variant="secondary" onClick={handleWriteSampleText}>
                            写入测试文本
                        </Button>
                    </div>
                </Card>

                {/* API Reference */}
                <Card title="使用的 API" icon="📖">
                    <CodeBlock>
                        {`// 读取文本
const text = clipboard.readText()

// 写入文本
await clipboard.writeText('Hello World')

// 读取图片 (PNG Buffer)
const imageBuffer = clipboard.readImage()

// 读取文件列表
const files = clipboard.readFiles()
// [{ path, name, size, isDirectory }]

// 获取格式
const format = clipboard.getFormat()
// 'text' | 'image' | 'files' | 'empty'`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
