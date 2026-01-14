import React, { useState, useEffect, useCallback } from 'react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock } from '../../components'
import { useIntools, useNotification } from '../../hooks'

interface DisplayInfo {
    id: number
    label: string
    bounds: { x: number; y: number; width: number; height: number }
    workArea: { x: number; y: number; width: number; height: number }
    scaleFactor: number
    rotation: number
    isPrimary: boolean
}

interface CaptureSource {
    id: string
    name: string
    thumbnailDataUrl: string
    displayId?: string
    appIconDataUrl?: string
}

export function ScreenModule() {
    const { screen, media, clipboard, filesystem, dialog } = useIntools()
    const notify = useNotification()

    const [displays, setDisplays] = useState<DisplayInfo[]>([])
    const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
    const [sources, setSources] = useState<CaptureSource[]>([])
    const [screenshot, setScreenshot] = useState<string | null>(null)
    const [cameraAccess, setCameraAccess] = useState<boolean | null>(null)
    const [micAccess, setMicAccess] = useState<boolean | null>(null)
    const [loading, setLoading] = useState(false)

    const loadDisplays = useCallback(async () => {
        try {
            const allDisplays = await screen.getAllDisplays()
            setDisplays(allDisplays || [])
        } catch (error) {
            console.error('Failed to get displays:', error)
        }
    }, [screen])

    const loadSources = useCallback(async () => {
        try {
            const allSources = await screen.getSources({
                types: ['screen', 'window'],
                thumbnailSize: { width: 200, height: 150 },
            })
            setSources(allSources || [])
        } catch (error) {
            console.error('Failed to get sources:', error)
        }
    }, [screen])

    const checkPermissions = useCallback(async () => {
        const camera = await media.hasCameraAccess()
        setCameraAccess(camera ?? null)

        const mic = await media.hasMicrophoneAccess()
        setMicAccess(mic ?? null)
    }, [media])

    useEffect(() => {
        loadDisplays()
        checkPermissions()
    }, [loadDisplays, checkPermissions])

    // Update cursor position periodically
    useEffect(() => {
        const updateCursor = async () => {
            const pos = await screen.getCursorScreenPoint()
            setCursorPos(pos || null)
        }

        updateCursor()
        const interval = setInterval(updateCursor, 500)
        return () => clearInterval(interval)
    }, [screen])

    const handleCapture = useCallback(async () => {
        setLoading(true)
        try {
            const buffer = await screen.capture({ format: 'png' })
            if (buffer) {
                // Convert to base64 data URL
                const base64 = btoa(
                    new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                )
                setScreenshot(`data:image/png;base64,${base64}`)
                notify.success('截图成功')
            }
        } catch (error) {
            notify.error('截图失败')
        } finally {
            setLoading(false)
        }
    }, [screen, notify])

    const handleCaptureSource = useCallback(async (sourceId: string) => {
        setLoading(true)
        try {
            const buffer = await screen.capture({ sourceId, format: 'png' })
            if (buffer) {
                const base64 = btoa(
                    new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                )
                setScreenshot(`data:image/png;base64,${base64}`)
                notify.success('截图成功')
            }
        } catch (error) {
            notify.error('截图失败')
        } finally {
            setLoading(false)
        }
    }, [screen, notify])

    const handleRegionCapture = useCallback(async () => {
        setLoading(true)
        try {
            const result = await screen.screenCapture()
            if (result) {
                // 不再设置主界面预览，等待编辑结果
                // setScreenshot(result)
                // localStorage.setItem('intools-temp-screenshot', result)

                const channel = new BroadcastChannel('intools-image-editor')

                // 监听编辑器消息
                channel.onmessage = (event) => {
                    const { type, data } = event.data
                    if (type === 'READY') {
                        // 编辑器就绪，发送图片
                        channel.postMessage({ type: 'INIT_IMAGE', data: result })
                    } else if (type === 'SAVE_IMAGE') {
                        // 接收编辑后的图片
                        setScreenshot(data)
                        notify.success('收到编辑后的图片')
                        channel.close()
                        // 恢复显示主窗口
                        if (window.intools?.window?.show) {
                            window.intools.window.show()
                        }
                    }
                }

                // 打开独立编辑器窗口
                if (window.intools?.window?.create) {
                    await window.intools.window.create('/image-editor', {
                        title: '图片编辑器',
                        width: 900,
                        height: 700
                    })
                }

                // notify.success('区域截图成功')
            } else {
                notify.info('已取消截图')
                // 恢复显示主窗口
                if (window.intools?.window?.show) {
                    window.intools.window.show()
                }
            }
        } catch (error) {
            console.error(error)
            notify.error('截图失败')
            // 恢复显示主窗口
            if (window.intools?.window?.show) {
                window.intools.window.show()
            }
        } finally {
            setLoading(false)
        }
    }, [screen, notify])

    const handleCopyScreenshot = useCallback(async () => {
        if (!screenshot) return
        try {
            // Convert base64 to buffer
            const base64Data = screenshot.split(',')[1]
            const binaryString = atob(base64Data)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
            }
            await clipboard.writeImage(bytes.buffer)
            notify.success('已复制到剪贴板')
        } catch (error) {
            notify.error('复制失败')
        }
    }, [screenshot, clipboard, notify])

    const handleSaveScreenshot = useCallback(async () => {
        if (!screenshot) return
        try {
            const savePath = await dialog.showSaveDialog({
                title: '保存截图',
                defaultPath: `screenshot-${Date.now()}.png`,
                filters: [{ name: 'PNG 图片', extensions: ['png'] }],
            })

            if (savePath) {
                const base64Data = screenshot.split(',')[1]
                await filesystem.writeFile(savePath, base64Data, 'base64')
                notify.success('截图已保存')
            }
        } catch (error) {
            notify.error('保存失败')
        }
    }, [screenshot, dialog, filesystem, notify])

    const handleRequestCamera = useCallback(async () => {
        try {
            const granted = await media.askForAccess('camera')
            setCameraAccess(granted ?? null)
            if (granted) {
                notify.success('摄像头权限已获取')
            } else {
                notify.warning('摄像头权限被拒绝')
            }
        } catch (error) {
            notify.error('请求权限失败')
        }
    }, [media, notify])

    const handleRequestMic = useCallback(async () => {
        try {
            const granted = await media.askForAccess('microphone')
            setMicAccess(granted ?? null)
            if (granted) {
                notify.success('麦克风权限已获取')
            } else {
                notify.warning('麦克风权限被拒绝')
            }
        } catch (error) {
            notify.error('请求权限失败')
        }
    }, [media, notify])

    return (
        <div className="main-content">
            <PageHeader
                icon="🖥️"
                title="屏幕与捕获"
                description="显示器信息、截图和权限管理"
            />
            <div className="page-content">
                {/* Display Info */}
                <Card
                    title={`显示器 (${displays.length})`}
                    icon="🖥️"
                    actions={<Button variant="secondary" onClick={loadDisplays}>刷新</Button>}
                >
                    <div className="grid grid-2">
                        {displays.map((display) => (
                            <div
                                key={display.id}
                                style={{
                                    padding: 'var(--spacing-md)',
                                    background: 'var(--bg-tertiary)',
                                    borderRadius: 'var(--radius-md)',
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: 'var(--spacing-sm)',
                                }}>
                                    <span style={{ fontWeight: 600 }}>{display.label || `显示器 ${display.id}`}</span>
                                    {display.isPrimary && <StatusBadge status="info">主显示器</StatusBadge>}
                                </div>
                                <div className="info-grid" style={{ fontSize: '12px' }}>
                                    <span className="info-label">分辨率</span>
                                    <span className="info-value">{display.bounds.width} × {display.bounds.height}</span>

                                    <span className="info-label">缩放</span>
                                    <span className="info-value">@{display.scaleFactor}x</span>

                                    <span className="info-label">位置</span>
                                    <span className="info-value">({display.bounds.x}, {display.bounds.y})</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    {cursorPos && (
                        <div style={{
                            marginTop: 'var(--spacing-md)',
                            fontSize: '12px',
                            color: 'var(--text-secondary)',
                        }}>
                            鼠标位置: X: {cursorPos.x}, Y: {cursorPos.y}
                        </div>
                    )}
                </Card>

                {/* Screenshot */}
                <Card title="截图" icon="📸">
                    <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                        <Button onClick={handleCapture} loading={loading}>
                            截取主屏幕
                        </Button>
                        <Button variant="primary" onClick={handleRegionCapture} loading={loading}>
                            区域截图
                        </Button>
                        <Button variant="secondary" onClick={loadSources}>
                            获取屏幕源列表
                        </Button>
                    </div>

                    {/* Sources */}
                    {sources.length > 0 && (
                        <div style={{ marginBottom: 'var(--spacing-md)' }}>
                            <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                                可用源 (点击截图)
                            </div>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                                gap: 'var(--spacing-sm)',
                            }}>
                                {sources.slice(0, 12).map((source) => (
                                    <div
                                        key={source.id}
                                        onClick={() => handleCaptureSource(source.id)}
                                        style={{
                                            cursor: 'pointer',
                                            padding: 'var(--spacing-xs)',
                                            background: 'var(--bg-tertiary)',
                                            borderRadius: 'var(--radius-sm)',
                                            transition: 'all var(--transition-fast)',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'var(--bg-hover)'
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'var(--bg-tertiary)'
                                        }}
                                    >
                                        {source.thumbnailDataUrl && (
                                            <img
                                                src={source.thumbnailDataUrl}
                                                alt={source.name}
                                                style={{
                                                    width: '100%',
                                                    borderRadius: 'var(--radius-xs)',
                                                    marginBottom: 'var(--spacing-xs)',
                                                }}
                                            />
                                        )}
                                        <div style={{
                                            fontSize: '11px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {source.name}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Screenshot Preview */}
                    {screenshot && (
                        <div>
                            <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>截图预览</div>
                            <div className="preview-box" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <img src={screenshot} alt="截图" />
                            </div>
                            <div className="action-bar">
                                <Button variant="secondary" onClick={handleCopyScreenshot}>
                                    复制到剪贴板
                                </Button>
                                <Button variant="secondary" onClick={handleSaveScreenshot}>
                                    保存到文件
                                </Button>
                            </div>
                        </div>
                    )}
                </Card>

                {/* Permissions */}
                <Card title="媒体权限" icon="🔒">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                <span>📷 摄像头</span>
                                <StatusBadge status={cameraAccess ? 'success' : 'error'}>
                                    {cameraAccess === null ? '未知' : cameraAccess ? '已授权' : '未授权'}
                                </StatusBadge>
                            </div>
                            <Button variant="secondary" onClick={handleRequestCamera}>
                                请求权限
                            </Button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                <span>🎤 麦克风</span>
                                <StatusBadge status={micAccess ? 'success' : 'error'}>
                                    {micAccess === null ? '未知' : micAccess ? '已授权' : '未授权'}
                                </StatusBadge>
                            </div>
                            <Button variant="secondary" onClick={handleRequestMic}>
                                请求权限
                            </Button>
                        </div>
                    </div>
                </Card>

                {/* API Reference */}
                <Card title="使用的 API" icon="📖">
                    <CodeBlock>
                        {`// 显示器
const displays = await screen.getAllDisplays()
const primary = await screen.getPrimaryDisplay()
const cursor = await screen.getCursorScreenPoint()

// 屏幕源
const sources = await screen.getSources({
  types: ['screen', 'window'],
  thumbnailSize: { width: 200, height: 150 }
})

// 截图
const buffer = await screen.capture({ format: 'png' })
const buffer = await screen.capture({ sourceId: 'screen:0:0' })

// 媒体权限
await media.hasCameraAccess()
await media.hasMicrophoneAccess()
await media.askForAccess('camera')`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
