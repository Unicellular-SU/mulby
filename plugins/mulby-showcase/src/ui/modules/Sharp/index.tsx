import { useState, useCallback } from 'react'
import { PageHeader, Card, Button, CodeBlock } from '../../components'
import { useNotification } from '../../hooks'

interface ImageMetadata {
    format?: string
    width?: number
    height?: number
    channels?: number
    space?: string
    depth?: string
    density?: number
    hasAlpha?: boolean
}

interface SharpVersion {
    sharp: Record<string, string>
    format: Record<string, any>
}

/**
 * Sharp 图像处理模块演示
 * 展示 mulby.sharp() API 的各种功能
 */
export function SharpModule() {
    const notify = useNotification()

    // 状态
    const [sourceImage, setSourceImage] = useState<string | null>(null)
    const [resultImage, setResultImage] = useState<string | null>(null)
    const [metadata, setMetadata] = useState<ImageMetadata | null>(null)
    const [loading, setLoading] = useState(false)
    const [sharpVersion, setSharpVersion] = useState<SharpVersion | null>(null)
    const [sourcePath, setSourcePath] = useState<string>('')

    // 工具函数：ArrayBuffer 转 Base64 Data URL
    const bufferToDataUrl = (buffer: ArrayBuffer, format: string = 'png'): string => {
        const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )
        return `data:image/${format};base64,${base64}`
    }

    // 选择图片文件
    const handleSelectImage = useCallback(async () => {
        try {
            const paths = await window.mulby?.dialog?.showOpenDialog({
                title: '选择图片',
                filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'] }],
                properties: ['openFile']
            })

            if (paths && paths.length > 0) {
                setSourcePath(paths[0])
                // 读取图片预览
                const data = await window.mulby?.filesystem?.readFile(paths[0], 'base64')
                if (data) {
                    const ext = paths[0].split('.').pop()?.toLowerCase() || 'png'
                    setSourceImage(`data:image/${ext};base64,${data}`)
                    setResultImage(null)
                    setMetadata(null)
                    notify.success('图片已加载')
                }
            }
        } catch (error) {
            notify.error('选择图片失败')
        }
    }, [notify])

    // 截取屏幕作为图片来源
    const handleCaptureScreen = useCallback(async () => {
        setLoading(true)
        try {
            const buffer = await window.mulby?.screen?.capture({ format: 'png' })
            if (buffer) {
                // 保存到临时文件
                const tempPath = await window.mulby?.system?.getPath('temp')
                if (tempPath) {
                    const filePath = `${tempPath}/sharp-demo-${Date.now()}.png`
                    const base64 = btoa(
                        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                    )
                    await window.mulby?.filesystem?.writeFile(filePath, base64, 'base64')
                    setSourcePath(filePath)
                    setSourceImage(bufferToDataUrl(buffer, 'png'))
                    setResultImage(null)
                    setMetadata(null)
                    notify.success('截图完成')
                }
            }
        } catch (error) {
            notify.error('截图失败')
        } finally {
            setLoading(false)
        }
    }, [notify])

    // 获取 Sharp 版本
    const handleGetVersion = useCallback(async () => {
        try {
            const version = await window.mulby?.getSharpVersion?.()
            if (version) {
                setSharpVersion(version)
                notify.success('获取版本信息成功')
            }
        } catch (error) {
            notify.error('获取版本失败')
        }
    }, [notify])

    // 获取图片元数据
    const handleGetMetadata = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            console.log('[Sharp Test] sourcePath:', sourcePath)
            console.log('[Sharp Test] window.mulby.sharp:', typeof window.mulby?.sharp)

            const sharpFn = window.mulby?.sharp
            console.log('[Sharp Test] sharpFn:', sharpFn)

            if (!sharpFn) {
                console.error('[Sharp Test] sharp 函数不存在!')
                notify.error('sharp API 不可用')
                return
            }

            console.log('[Sharp Test] 调用 sharpFn...')
            const sharpInstance = sharpFn(sourcePath)
            console.log('[Sharp Test] sharpInstance:', sharpInstance)
            console.log('[Sharp Test] sharpInstance type:', typeof sharpInstance)
            console.log('[Sharp Test] sharpInstance.metadata:', sharpInstance?.metadata)

            if (!sharpInstance) {
                console.error('[Sharp Test] sharp 返回 undefined!')
                notify.error('sharp() 返回 undefined')
                return
            }

            console.log('[Sharp Test] 调用 metadata...')
            const meta = await sharpInstance.metadata()
            console.log('[Sharp Test] meta:', meta)

            if (meta) {
                setMetadata(meta)
                notify.success('获取元数据成功')
            }
        } catch (error: any) {
            console.error('[Sharp Test] 错误:', error)
            notify.error(`获取元数据失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 调整尺寸
    const handleResize = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.(sourcePath)
                .resize(200, 200, { fit: 'cover' })
                .toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer))
                notify.success('调整尺寸成功 (200x200)')
            }
        } catch (error: any) {
            notify.error(`调整尺寸失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 旋转图片
    const handleRotate = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.(sourcePath)
                .rotate(90)
                .toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer))
                notify.success('旋转 90° 成功')
            }
        } catch (error: any) {
            notify.error(`旋转失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 灰度化
    const handleGrayscale = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.(sourcePath)
                .grayscale()
                .toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer))
                notify.success('灰度化成功')
            }
        } catch (error: any) {
            notify.error(`灰度化失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 模糊
    const handleBlur = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.(sourcePath)
                .blur(5)
                .toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer))
                notify.success('模糊处理成功 (sigma=5)')
            }
        } catch (error: any) {
            notify.error(`模糊失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 锐化
    const handleSharpen = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.(sourcePath)
                .sharpen()
                .toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer))
                notify.success('锐化成功')
            }
        } catch (error: any) {
            notify.error(`锐化失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 反相
    const handleNegate = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.(sourcePath)
                .negate()
                .toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer))
                notify.success('反相处理成功')
            }
        } catch (error: any) {
            notify.error(`反相失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 水平翻转
    const handleFlop = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.(sourcePath)
                .flop()
                .toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer))
                notify.success('水平翻转成功')
            }
        } catch (error: any) {
            notify.error(`翻转失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 转换格式 (WebP)
    const handleConvertWebP = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.(sourcePath)
                .webp({ quality: 80 })
                .toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer, 'webp'))
                notify.success('转换 WebP 成功 (quality=80)')
            }
        } catch (error: any) {
            notify.error(`转换失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 链式操作组合
    const handleChainedOperations = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择图片')
            return
        }
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.(sourcePath)
                .resize(300, 300, { fit: 'cover' })
                .grayscale()
                .blur(2)
                .toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer))
                notify.success('链式操作成功 (resize → grayscale → blur)')
            }
        } catch (error: any) {
            notify.error(`链式操作失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [sourcePath, notify])

    // 创建空白图像
    const handleCreateImage = useCallback(async () => {
        setLoading(true)
        try {
            const buffer = await window.mulby?.sharp?.({
                create: {
                    width: 200,
                    height: 200,
                    channels: 4,
                    background: { r: 59, g: 130, b: 246, alpha: 1 }
                }
            }).png().toBuffer()
            if (buffer) {
                setResultImage(bufferToDataUrl(buffer))
                notify.success('创建蓝色图像成功 (200x200)')
            }
        } catch (error: any) {
            notify.error(`创建图像失败: ${error.message}`)
        } finally {
            setLoading(false)
        }
    }, [notify])

    // 保存处理后的图片
    const handleSaveResult = useCallback(async () => {
        if (!resultImage) {
            notify.warning('没有处理结果可保存')
            return
        }
        try {
            const savePath = await window.mulby?.dialog?.showSaveDialog({
                title: '保存图片',
                defaultPath: `sharp-result-${Date.now()}.png`,
                filters: [{ name: 'PNG 图片', extensions: ['png'] }],
            })
            if (savePath) {
                const base64Data = resultImage.split(',')[1]
                await window.mulby?.filesystem?.writeFile(savePath, base64Data, 'base64')
                notify.success('保存成功')
            }
        } catch (error) {
            notify.error('保存失败')
        }
    }, [resultImage, notify])

    return (
        <div className="main-content">
            <PageHeader
                icon="🖼️"
                title="Sharp 图像处理"
                description="高性能图像处理 API 演示"
            />
            <div className="page-content">
                {/* 版本信息 */}
                <Card title="Sharp 版本" icon="ℹ️">
                    <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                        <Button onClick={handleGetVersion}>获取 Sharp 版本</Button>
                    </div>
                    {sharpVersion && (
                        <div style={{
                            padding: 'var(--spacing-md)',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '12px'
                        }}>
                            <div><strong>vips:</strong> {sharpVersion.sharp?.vips || 'N/A'}</div>
                            <div><strong>libsharp:</strong> {sharpVersion.sharp?.sharp || 'N/A'}</div>
                        </div>
                    )}
                </Card>

                {/* 图片来源 */}
                <Card title="图片来源" icon="📁">
                    <div className="action-bar">
                        <Button variant="primary" onClick={handleSelectImage}>
                            📂 选择图片文件
                        </Button>
                        <Button variant="secondary" onClick={handleCaptureScreen} loading={loading}>
                            📸 截取屏幕
                        </Button>
                    </div>
                    {sourcePath && (
                        <div style={{
                            marginTop: 'var(--spacing-md)',
                            fontSize: '12px',
                            color: 'var(--text-secondary)',
                            wordBreak: 'break-all'
                        }}>
                            当前文件: {sourcePath}
                        </div>
                    )}
                </Card>

                {/* 图片预览 */}
                {(sourceImage || resultImage) && (
                    <Card title="图片预览" icon="🖼️">
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: resultImage ? '1fr 1fr' : '1fr',
                            gap: 'var(--spacing-md)'
                        }}>
                            {sourceImage && (
                                <div>
                                    <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                                        原图
                                    </div>
                                    <div className="preview-box">
                                        <img src={sourceImage} alt="原图" style={{ maxHeight: '200px' }} />
                                    </div>
                                </div>
                            )}
                            {resultImage && (
                                <div>
                                    <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                                        处理结果
                                    </div>
                                    <div className="preview-box">
                                        <img src={resultImage} alt="处理结果" style={{ maxHeight: '200px' }} />
                                    </div>
                                </div>
                            )}
                        </div>
                        {resultImage && (
                            <div className="action-bar" style={{ marginTop: 'var(--spacing-md)' }}>
                                <Button variant="secondary" onClick={handleSaveResult}>
                                    💾 保存结果
                                </Button>
                            </div>
                        )}
                    </Card>
                )}

                {/* 元数据 */}
                <Card title="图片元数据" icon="📊">
                    <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                        <Button onClick={handleGetMetadata} loading={loading} disabled={!sourcePath}>
                            获取元数据
                        </Button>
                    </div>
                    {metadata && (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: 'var(--spacing-sm)',
                            padding: 'var(--spacing-md)',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '13px'
                        }}>
                            <div><strong>格式:</strong> {metadata.format || 'N/A'}</div>
                            <div><strong>尺寸:</strong> {metadata.width}×{metadata.height}</div>
                            <div><strong>通道:</strong> {metadata.channels}</div>
                            <div><strong>色彩空间:</strong> {metadata.space || 'N/A'}</div>
                            <div><strong>位深:</strong> {metadata.depth || 'N/A'}</div>
                            <div><strong>Alpha:</strong> {metadata.hasAlpha ? '是' : '否'}</div>
                        </div>
                    )}
                </Card>

                {/* 图像处理操作 */}
                <Card title="图像处理" icon="🎨">
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                            尺寸变换
                        </div>
                        <div className="action-bar">
                            <Button onClick={handleResize} loading={loading} disabled={!sourcePath}>
                                📐 调整尺寸 (200×200)
                            </Button>
                            <Button onClick={handleRotate} loading={loading} disabled={!sourcePath}>
                                🔄 旋转 90°
                            </Button>
                            <Button onClick={handleFlop} loading={loading} disabled={!sourcePath}>
                                ↔️ 水平翻转
                            </Button>
                        </div>
                    </div>

                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                            颜色处理
                        </div>
                        <div className="action-bar">
                            <Button onClick={handleGrayscale} loading={loading} disabled={!sourcePath}>
                                ⚫ 灰度化
                            </Button>
                            <Button onClick={handleNegate} loading={loading} disabled={!sourcePath}>
                                🔀 反相
                            </Button>
                        </div>
                    </div>

                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                            滤镜效果
                        </div>
                        <div className="action-bar">
                            <Button onClick={handleBlur} loading={loading} disabled={!sourcePath}>
                                💨 模糊 (σ=5)
                            </Button>
                            <Button onClick={handleSharpen} loading={loading} disabled={!sourcePath}>
                                ✨ 锐化
                            </Button>
                        </div>
                    </div>

                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                            格式转换
                        </div>
                        <div className="action-bar">
                            <Button onClick={handleConvertWebP} loading={loading} disabled={!sourcePath}>
                                🌐 转换 WebP
                            </Button>
                        </div>
                    </div>

                    <div>
                        <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                            高级功能
                        </div>
                        <div className="action-bar">
                            <Button variant="primary" onClick={handleChainedOperations} loading={loading} disabled={!sourcePath}>
                                ⛓️ 链式操作 (resize→grayscale→blur)
                            </Button>
                            <Button onClick={handleCreateImage} loading={loading}>
                                🆕 创建空白图像
                            </Button>
                        </div>
                    </div>
                </Card>

                {/* API 参考 */}
                <Card title="使用的 API" icon="📖">
                    <CodeBlock>
                        {`// 调整尺寸
const buffer = await mulby.sharp('/path/to/image.jpg')
  .resize(200, 200, { fit: 'cover' })
  .toBuffer()

// 链式操作
const buffer = await mulby.sharp('/path/to/image.jpg')
  .resize(300, 300)
  .grayscale()
  .blur(2)
  .toBuffer()

// 格式转换
await mulby.sharp('/path/to/input.png')
  .jpeg({ quality: 80 })
  .toFile('/path/to/output.jpg')

// 获取元数据
const metadata = await mulby.sharp('/path/to/image.png').metadata()
// { width, height, format, channels, space, hasAlpha, ... }

// 创建空白图像
const buffer = await mulby.sharp({
  create: {
    width: 200, height: 200, channels: 4,
    background: { r: 255, g: 0, b: 0, alpha: 1 }
  }
}).png().toBuffer()

// 其他方法: rotate(), flip(), flop(), negate(), sharpen(), blur(), ...`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
