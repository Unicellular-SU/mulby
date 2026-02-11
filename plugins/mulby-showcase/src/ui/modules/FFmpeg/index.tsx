import { useState, useCallback, useRef } from 'react'
import { PageHeader, Card, Button, CodeBlock } from '../../components'
import { useNotification } from '../../hooks'

/**
 * FFmpeg 音视频处理模块演示
 * 展示 mulby.ffmpeg API 的各种功能
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
            const available = await window.mulby?.ffmpeg?.isAvailable()
            setIsAvailable(available)

            if (available) {
                const ver = await window.mulby?.ffmpeg?.getVersion()
                setVersion(ver)
                const path = await window.mulby?.ffmpeg?.getPath()
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
            const result = await window.mulby?.ffmpeg?.download((progress) => {
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
            const paths = await window.mulby?.dialog?.showOpenDialog({
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
            const task = window.mulby?.ffmpeg?.run(
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
                await task.promise
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
            const task = window.mulby?.ffmpeg?.run(
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
                await task.promise
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
            await window.mulby?.ffmpeg?.run(['-i', inputFile])
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


    // 屏幕录制状态
    const [recording, setRecording] = useState(false)
    const [recordMouse, setRecordMouse] = useState(true)

    // 生成录屏参数
    const getRecordingArgs = async (
        speaker: boolean | string,
        microphone: string | boolean,
        captureMouse: boolean,
        area: { x: number; y: number; width: number; height: number; screenId?: string } | string | null,
        outputFile: string
    ) => {
        const isWindows = await window.mulby.system.isWindows()
        const isMacOS = await window.mulby.system.isMacOS()

        if (isWindows) {
            if (speaker && typeof speaker !== 'string') {
                throw new Error('扬声器录制需要启用「立体声混音」')
            }
            return [
                ...(microphone ? ['-f', 'dshow', '-i', `audio=${microphone}`] : []),
                ...(speaker ? ['-f', 'dshow', '-i', `audio=${speaker}`] : []),
                '-f', 'gdigrab',
                '-framerate', '30',
                '-draw_mouse', captureMouse ? '1' : '0',
                ...(area && typeof area === 'object'
                    ? ['-offset_x', String(Math.round(area.x)), '-offset_y', String(Math.round(area.y)), '-video_size', `${Math.round(area.width)}x${Math.round(area.height)}`]
                    : []),
                '-i', 'desktop',
                ...((microphone && speaker) ? ['-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]', '-map', '2:v', '-map', '[aout]'] : []),
                '-r', '30',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', 'ultrafast',
                '-crf', '23',
                ...((microphone || speaker) ? ['-c:a', 'aac', '-b:a', '192k'] : []),
                '-y',
                outputFile
            ]
        }

        if (isMacOS) {
            if (speaker || microphone) {
                throw new Error('当前示例 macOS 暂不支持录制声音')
            }
            // macOS 需要 avfoundation，通常 -i "1" 为主屏幕
            // 注意：需要确保终端/应用有屏幕录制权限
            return [
                '-f', 'avfoundation',
                '-framerate', '30',
                '-capture_cursor', captureMouse ? '1' : '0',
                ...(
                    area && typeof area === 'object'
                        ? ['-i', String(area.screenId || '1'), '-vf', `crop=${area.width}:${area.height}:${area.x}:${area.y}`]
                        : ['-i', String(area || '1')]
                ),
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', 'ultrafast',
                '-crf', '23',
                '-y',
                outputFile
            ]
        }

        throw new Error('不支持当前平台录制')
    }

    // 开始录制
    const handleStartRecording = useCallback(async () => {
        try {
            // 选择保存路径
            const savePath = await window.mulby.dialog.showSaveDialog({
                title: '保存录屏文件',
                defaultPath: 'capture.mp4',
                filters: [{ name: '视频文件', extensions: ['mp4'] }]
            })

            if (!savePath) return

            setRecording(true)
            setRunProgress(null)
            notify.info('开始录制...')

            // 开始录制 (全屏，捕获鼠标，无音频)
            // windows 需要 gdigrab, macos 需要 avfoundation
            // 这里为了演示，传 null 表示全屏
            const args = await getRecordingArgs(false, false, recordMouse, null, savePath)

            const task = window.mulby.ffmpeg.run(
                args,
                (progress) => {
                    setRunProgress({
                        percent: undefined,
                        time: progress.time,
                        speed: progress.speed
                    })
                }
            )

            if (task) {
                currentTaskRef.current = task
                await task.promise  // 等待 Promise 完成
                notify.success(`录制完成: ${savePath}`)
            }
        } catch (error: any) {
            if (error.message.includes('SIGKILL') || error.message.includes('exit code: 255')) {
                // 忽略 kill/quit 导致的错误
                return
            }
            notify.error(`录制失败: ${error.message}`)
        } finally {
            setRecording(false)
            setRunProgress(null)
            currentTaskRef.current = null
        }
    }, [recordMouse, notify])

    // 停止录制
    const handleStopRecording = useCallback(() => {
        console.log('[FFmpeg UI] handleStopRecording 被调用')
        console.log('[FFmpeg UI] currentTaskRef.current:', currentTaskRef.current)
        if (currentTaskRef.current) {
            console.log('[FFmpeg UI] 调用 quit()')
            currentTaskRef.current.quit() // 发送 q 停止录制
            notify.info('正在停止录制...')
        } else {
            console.log('[FFmpeg UI] currentTaskRef.current 为空，无法停止')
            notify.warning('没有正在进行的录制任务')
        }
    }, [notify])

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

                {/* 屏幕录制 */}
                <Card title="屏幕录制 (实验性)" icon="🎥">
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={recordMouse}
                                onChange={e => setRecordMouse(e.target.checked)}
                            />
                            捕获鼠标光标
                        </label>
                    </div>
                    <div className="action-bar">
                        {!recording ? (
                            <Button
                                variant="primary"
                                onClick={handleStartRecording}
                                disabled={isAvailable === false}
                            >
                                🔴 开始录制
                            </Button>
                        ) : (
                            <Button
                                variant="secondary"
                                onClick={handleStopRecording}
                                style={{
                                    borderColor: 'var(--error)',
                                    color: 'var(--error)'
                                }}
                            >
                                ⏹️ 停止录制
                            </Button>
                        )}
                    </div>
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
                                <span>{recording ? '录制中...' : '处理中...'}</span>
                                <span>{runProgress.percent !== undefined ? `${runProgress.percent}%` : runProgress.time}</span>
                            </div>
                            {runProgress.percent !== undefined && (
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
                            )}
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
                        {`// 生成录屏参数
async function getRecordingArgs (speaker, microphone, captureMouse, area, outputFile) {
  const isWindows = await mulby.system.isWindows()

                        if (isWindows) {
    // Windows 参数构造 (gdigrab + dshow)
    return [
                        // ... 省略具体参数构造细节 ...
                        '-f', 'gdigrab', '-i', 'desktop',
                        '-y', outputFile
                        ]
  }

                        // macOS 参数构造 (avfoundation)
                        return ['-f', 'avfoundation', '-i', '1', '-y', outputFile]
}

                        // 使用示例：
                        // 1. 获取参数
                        const args = await getRecordingArgs(false, false, true, null, '/path/to.mp4')

// 2. 启动任务 (注意：不要 await run，先拿到 task 对象以便控制)
const task = mulby.ffmpeg.run(args, (progress) => {
                            console.log('录制时间:', progress.time)
                        })

// 3. 10秒后停止录制 (发送 'q' 命令)
setTimeout(() => task.quit(), 10000)

// 4. 等待任务结束
await task`}
                    </CodeBlock>
                </Card>
            </div>
        </div>
    )
}

