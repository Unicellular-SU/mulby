import { useState, useCallback, useRef } from 'react'
import { PageHeader, Card, Button, CodeBlock } from '../../components'
import { useNotification } from '../../hooks'

/**
 * FFmpeg 音视频处理模块演示
 * 展示 intools.ffmpeg API 的各种功能
 */
export function FFmpegModule() {
    const notify = useNotification()

    // 状态
    const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
    const [version, setVersion] = useState<string | null>(null)
    const [ffmpegPath, setFFmpegPath] = useState<string | null>(null)
    const [downloading, setDownloading] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState<{ phase: string; percent: number } | null>(null)
    const [running, setRunning] = useState(false)
    const [runProgress, setRunProgress] = useState<{ percent?: number; time?: string; speed?: string } | null>(null)
    const [inputFile, setInputFile] = useState<string>('')
    const [outputFile, setOutputFile] = useState<string>('')

    // 存储当前任务的取消函数
    const currentTaskRef = useRef<{ kill: () => void; quit: () => void } | null>(null)

    // 检查 FFmpeg 是否可用
    const handleCheckAvailability = useCallback(async () => {
        try {
            const available = await window.intools?.ffmpeg?.isAvailable()
            setIsAvailable(available)

            if (available) {
                const ver = await window.intools?.ffmpeg?.getVersion()
                setVersion(ver)
                const path = await window.intools?.ffmpeg?.getPath()
                setFFmpegPath(path)
                notify.success('FFmpeg 已安装')
            } else {
                notify.warning('FFmpeg 未安装，请先下载')
            }
        } catch (error: any) {
            notify.error(`检查失败: ${error.message}`)
        }
    }, [notify])

    // 下载 FFmpeg
    const handleDownload = useCallback(async () => {
        setDownloading(true)
        setDownloadProgress(null)
        try {
            const result = await window.intools?.ffmpeg?.download((progress) => {
                setDownloadProgress({ phase: progress.phase, percent: progress.percent })
            })

            if (result?.success) {
                notify.success('FFmpeg 下载安装完成！')
                // 刷新状态
                await handleCheckAvailability()
            } else {
                notify.error(`下载失败: ${result?.error || '未知错误'}`)
            }
        } catch (error: any) {
            notify.error(`下载失败: ${error.message}`)
        } finally {
            setDownloading(false)
            setDownloadProgress(null)
        }
    }, [notify, handleCheckAvailability])

    // 选择输入文件
    const handleSelectInput = useCallback(async () => {
        try {
            const paths = await window.intools?.dialog?.showOpenDialog({
                title: '选择视频/音频文件',
                filters: [
                    { name: '媒体文件', extensions: ['mp4', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'flac', 'webm'] }
                ],
                properties: ['openFile']
            })
            if (paths && paths.length > 0) {
                setInputFile(paths[0])
                // 自动生成输出文件名
                const inputPath = paths[0]
                const lastDot = inputPath.lastIndexOf('.')
                const outputPath = lastDot > 0
                    ? inputPath.substring(0, lastDot) + '_output.mp4'
                    : inputPath + '_output.mp4'
                setOutputFile(outputPath)
                notify.success('已选择文件')
            }
        } catch (error) {
            notify.error('选择文件失败')
        }
    }, [notify])

    // 视频压缩
    const handleCompress = useCallback(async () => {
        if (!inputFile) {
            notify.warning('请先选择输入文件')
            return
        }

        setRunning(true)
        setRunProgress(null)

        try {
            const task = window.intools?.ffmpeg?.run(
                [
                    '-i', inputFile,
                    '-c:v', 'libx264',
                    '-crf', '28',
                    '-preset', 'fast',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-y',
                    outputFile
                ],
                (progress) => {
                    setRunProgress({
                        percent: progress.percent,
                        time: progress.time,
                        speed: progress.speed
                    })
                }
            )

            if (task) {
                currentTaskRef.current = task
                await task
                notify.success('视频压缩完成！')
            }
        } catch (error: any) {
            notify.error(`压缩失败: ${error.message}`)
        } finally {
            setRunning(false)
            setRunProgress(null)
            currentTaskRef.current = null
        }
    }, [inputFile, outputFile, notify])

    // 提取音频
    const handleExtractAudio = useCallback(async () => {
        if (!inputFile) {
            notify.warning('请先选择输入文件')
            return
        }

        const audioOutput = inputFile.replace(/\.[^/.]+$/, '.mp3')
        setRunning(true)

        try {
            const task = window.intools?.ffmpeg?.run(
                [
                    '-i', inputFile,
                    '-q:a', '0',
                    '-map', 'a',
                    '-y',
                    audioOutput
                ],
                (progress) => {
                    setRunProgress({
                        percent: progress.percent,
                        time: progress.time,
                        speed: progress.speed
                    })
                }
            )

            if (task) {
                currentTaskRef.current = task
                await task
                notify.success(`音频提取完成：${audioOutput}`)
            }
        } catch (error: any) {
            notify.error(`提取失败: ${error.message}`)
        } finally {
            setRunning(false)
            setRunProgress(null)
            currentTaskRef.current = null
        }
    }, [inputFile, notify])

    // 取消任务
    const handleCancel = useCallback(() => {
        if (currentTaskRef.current) {
            currentTaskRef.current.kill()
            notify.info('任务已取消')
        }
    }, [notify])

    // 优雅退出
    const handleQuit = useCallback(() => {
        if (currentTaskRef.current) {
            currentTaskRef.current.quit()
            notify.info('正在优雅退出...')
        }
    }, [notify])

    // 视频信息状态
    const [videoInfo, setVideoInfo] = useState<{
        duration: string | null
        bitrate: string | null
        video: string | null
        audio: string | null
    } | null>(null)
    const [gettingInfo, setGettingInfo] = useState(false)

    // 获取视频信息
    const handleGetVideoInfo = useCallback(async () => {
        if (!inputFile) {
            notify.warning('请先选择输入文件')
            return
        }

        setGettingInfo(true)
        setVideoInfo(null)

        try {
            // FFmpeg 不指定输出文件时会报错，但 stderr 包含媒体信息
            await window.intools?.ffmpeg?.run(['-i', inputFile])
        } catch (error: any) {
            // 从错误信息中提取媒体元数据
            const message = error.message || ''
            const videoStream = message.match(/Stream #\d+:\d+.*Video: ([^\n]+)/)
            const audioStream = message.match(/Stream #\d+:\d+.*Audio: ([^\n]+)/)
            const durationMatch = message.match(/Duration: ([^,]+)/)
            const bitrateMatch = message.match(/bitrate:\s*(\d+ kb\/s)/)

            const metadata = {
                duration: durationMatch?.[1] || null,
                bitrate: bitrateMatch?.[1] || null,
                video: videoStream?.[1] || null,
                audio: audioStream?.[1] || null,
            }

            if (metadata.duration || metadata.video || metadata.audio) {
                setVideoInfo(metadata)
                notify.success('获取视频信息成功')
            } else {
                notify.error('无法解析视频信息')
            }
        } finally {
            setGettingInfo(false)
        }
    }, [inputFile, notify])


    return (
        <div className="main-content">
            <PageHeader
                icon="🎬"
                title="FFmpeg 音视频处理"
                description="音视频转换、压缩、提取 API 演示"
            />
            <div className="page-content">
                {/* FFmpeg 状态 */}
                <Card title="FFmpeg 状态" icon="ℹ️">
                    <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                        <Button variant="primary" onClick={handleCheckAvailability}>
                            🔍 检查状态
                        </Button>
                        {isAvailable === false && (
                            <Button
                                variant="secondary"
                                onClick={handleDownload}
                                loading={downloading}
                            >
                                📥 下载 FFmpeg
                            </Button>
                        )}
                    </div>

                    {downloadProgress && (
                        <div style={{
                            padding: 'var(--spacing-md)',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            marginBottom: 'var(--spacing-md)'
                        }}>
                            <div style={{ marginBottom: 'var(--spacing-sm)' }}>
                                {downloadProgress.phase === 'downloading' && '📥 下载中...'}
                                {downloadProgress.phase === 'extracting' && '📦 解压中...'}
                                {downloadProgress.phase === 'done' && '✅ 完成'}
                            </div>
                            <div style={{
                                height: '8px',
                                background: 'var(--bg-secondary)',
                                borderRadius: '4px',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: `${downloadProgress.percent}%`,
                                    background: 'var(--accent-primary)',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                        </div>
                    )}

                    {isAvailable !== null && (
                        <div style={{
                            padding: 'var(--spacing-md)',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '13px'
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--spacing-sm)',
                                marginBottom: 'var(--spacing-sm)'
                            }}>
                                <span style={{ color: isAvailable ? 'var(--success)' : 'var(--warning)' }}>
                                    {isAvailable ? '✅' : '⚠️'}
                                </span>
                                <span>{isAvailable ? '已安装' : '未安装'}</span>
                            </div>
                            {version && <div><strong>版本:</strong> {version}</div>}
                            {ffmpegPath && (
                                <div style={{
                                    wordBreak: 'break-all',
                                    color: 'var(--text-secondary)',
                                    fontSize: '12px',
                                    marginTop: 'var(--spacing-sm)'
                                }}>
                                    <strong>路径:</strong> {ffmpegPath}
                                </div>
                            )}
                        </div>
                    )}
                </Card>

                {/* 文件选择 */}
                <Card title="文件选择" icon="📁">
                    <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                        <Button onClick={handleSelectInput}>
                            📂 选择输入文件
                        </Button>
                    </div>
                    {inputFile && (
                        <div style={{
                            padding: 'var(--spacing-md)',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '12px',
                            wordBreak: 'break-all'
                        }}>
                            <div><strong>输入:</strong> {inputFile}</div>
                            <div style={{ marginTop: 'var(--spacing-sm)' }}>
                                <strong>输出:</strong> {outputFile}
                            </div>
                        </div>
                    )}
                </Card>

                {/* 处理操作 */}
                <Card title="处理操作" icon="🎨">
                    {runProgress && (
                        <div style={{
                            padding: 'var(--spacing-md)',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            marginBottom: 'var(--spacing-md)'
                        }}>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginBottom: 'var(--spacing-sm)',
                                fontSize: '13px'
                            }}>
                                <span>处理中...</span>
                                <span>{runProgress.percent !== undefined ? `${runProgress.percent}%` : runProgress.time}</span>
                            </div>
                            <div style={{
                                height: '8px',
                                background: 'var(--bg-secondary)',
                                borderRadius: '4px',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: `${runProgress.percent || 0}%`,
                                    background: 'var(--accent-primary)',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                            {runProgress.speed && (
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--text-secondary)',
                                    marginTop: 'var(--spacing-sm)'
                                }}>
                                    速度: {runProgress.speed}
                                </div>
                            )}
                        </div>
                    )}

                    {videoInfo && (
                        <div style={{
                            padding: 'var(--spacing-md)',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            marginBottom: 'var(--spacing-md)',
                            fontSize: '13px',
                            lineHeight: '1.6'
                        }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>
                                <div><strong>⏱️ 时长:</strong> {videoInfo.duration || '未知'}</div>
                                <div><strong>📊 码率:</strong> {videoInfo.bitrate || '未知'}</div>
                            </div>
                            {videoInfo.video && (
                                <div style={{ marginBottom: 'var(--spacing-xs)' }}>
                                    <strong>📹 视频流:</strong>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginLeft: '1em' }}>{videoInfo.video}</div>
                                </div>
                            )}
                            {videoInfo.audio && (
                                <div>
                                    <strong>🔊 音频流:</strong>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginLeft: '1em' }}>{videoInfo.audio}</div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="action-bar">
                        <Button
                            variant="primary"
                            onClick={handleCompress}
                            loading={running}
                            disabled={!inputFile || isAvailable === false}
                        >
                            🗜️ 压缩视频
                        </Button>
                        <Button
                            onClick={handleExtractAudio}
                            loading={running}
                            disabled={!inputFile || isAvailable === false}
                        >
                            🎵 提取音频
                        </Button>
                        <Button
                            onClick={handleGetVideoInfo}
                            loading={gettingInfo}
                            disabled={!inputFile || isAvailable === false}
                        >
                            📊 获取信息
                        </Button>
                        {running && (
                            <>
                                <Button variant="secondary" onClick={handleQuit}>
                                    ⏸️ 优雅退出
                                </Button>
                                <Button variant="secondary" onClick={handleCancel}>
                                    ❌ 取消任务
                                </Button>
                            </>
                        )}
                    </div>
                </Card>

                {/* API 参考 */}
                <Card title="使用的 API" icon="📖">
                    <CodeBlock>
                        {`// 检查 FFmpeg 状态
const available = await intools.ffmpeg.isAvailable()
const version = await intools.ffmpeg.getVersion()

// 下载 FFmpeg
await intools.ffmpeg.download((progress) => {
  console.log(progress.phase, progress.percent + '%')
})

// 视频压缩
const task = intools.ffmpeg.run(
  ["-i", "input.mp4", "-crf", "28", "output.mp4"],
  (progress) => console.log(progress.percent + '%')
)

// 取消/退出
task.kill()  // 强制终止
task.quit()  // 优雅退出

// 获取媒体信息
intools.ffmpeg.run(["-i", "input.mp4"]).catch((err) => {
  // 从 err.message (stderr) 提取时长、码率等信息
  const duration = err.message.match(/Duration: ([^,]+)/)?.[1]
  console.log(duration)
})`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}
