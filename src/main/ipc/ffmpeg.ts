import { ipcMain } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import {
    isFFmpegInstalled,
    getFFmpegVersion,
    getFFmpegPath,
    downloadFFmpeg,
    DownloadProgressCallback,
} from '../services/ffmpeg-downloader'
import log from 'electron-log'

/**
 * FFmpeg IPC 处理器
 *
 * 实现 uTools 风格的 FFmpeg API：
 * - runFFmpeg(args, onProgress) 执行 FFmpeg 命令
 * - 支持 kill() 和 quit() 控制
 * - 进度回调解析
 */

// 活跃的 FFmpeg 进程映射
const activeProcesses = new Map<string, ChildProcess>()



/**
 * 解析 FFmpeg 进度输出
 *
 * FFmpeg stderr 输出格式示例:
 * frame=  120 fps= 30 q=28.0 size=  256kB time=00:00:04.00 bitrate= 524.3kbits/s speed=1.00x
 */
interface FFmpegProgress {
    bitrate: string
    fps: number
    frame: number
    percent?: number
    q: number | string
    size: string
    speed: string
    time: string
}

function parseProgress(line: string, duration?: number): FFmpegProgress | null {
    // 检查是否是进度行
    if (!line.includes('frame=') && !line.includes('size=')) {
        return null
    }

    const progress: Partial<FFmpegProgress> = {}

    // 解析各字段
    const frameMatch = line.match(/frame=\s*(\d+)/)
    if (frameMatch) progress.frame = parseInt(frameMatch[1], 10)

    const fpsMatch = line.match(/fps=\s*([\d.]+)/)
    if (fpsMatch) progress.fps = parseFloat(fpsMatch[1])

    const qMatch = line.match(/q=\s*([\d.-]+)/)
    if (qMatch) progress.q = parseFloat(qMatch[1])

    const sizeMatch = line.match(/size=\s*(\S+)/)
    if (sizeMatch) progress.size = sizeMatch[1]

    const timeMatch = line.match(/time=\s*(\S+)/)
    if (timeMatch) progress.time = timeMatch[1]

    const bitrateMatch = line.match(/bitrate=\s*(\S+)/)
    if (bitrateMatch) progress.bitrate = bitrateMatch[1]

    const speedMatch = line.match(/speed=\s*(\S+)/)
    if (speedMatch) progress.speed = speedMatch[1]

    // 计算进度百分比（如果有总时长）
    if (duration && progress.time) {
        const timeSeconds = parseTimeToSeconds(progress.time)
        if (timeSeconds > 0) {
            progress.percent = Math.min(100, Math.round((timeSeconds / duration) * 100))
        }
    }

    // 只有当解析到关键字段时才返回
    if (progress.frame !== undefined || progress.size !== undefined) {
        return {
            bitrate: progress.bitrate || '',
            fps: progress.fps || 0,
            frame: progress.frame || 0,
            percent: progress.percent,
            q: progress.q || 0,
            size: progress.size || '',
            speed: progress.speed || '',
            time: progress.time || '',
        }
    }

    return null
}

/**
 * 解析时间字符串为秒数
 * 格式: HH:MM:SS.ms
 */
function parseTimeToSeconds(time: string): number {
    const match = time.match(/(\d+):(\d+):(\d+)(?:\.(\d+))?/)
    if (!match) return 0

    const hours = parseInt(match[1], 10)
    const minutes = parseInt(match[2], 10)
    const seconds = parseInt(match[3], 10)
    const ms = match[4] ? parseInt(match[4], 10) / 100 : 0

    return hours * 3600 + minutes * 60 + seconds + ms
}

/**
 * 从 FFmpeg 输出中提取总时长
 */
function parseDuration(output: string): number | undefined {
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+)(?:\.(\d+))?/)
    if (!match) return undefined

    const hours = parseInt(match[1], 10)
    const minutes = parseInt(match[2], 10)
    const seconds = parseInt(match[3], 10)
    const ms = match[4] ? parseInt(match[4], 10) / 100 : 0

    return hours * 3600 + minutes * 60 + seconds + ms
}

export function registerFFmpegHandlers() {
    // 检查 FFmpeg 是否可用
    ipcMain.handle('ffmpeg:isAvailable', async () => {
        return isFFmpegInstalled()
    })

    // 获取 FFmpeg 版本
    ipcMain.handle('ffmpeg:getVersion', async () => {
        return getFFmpegVersion()
    })

    // 获取 FFmpeg 路径
    ipcMain.handle('ffmpeg:getPath', async () => {
        const installed = await isFFmpegInstalled()
        if (!installed) return null
        return getFFmpegPath()
    })

    // 下载 FFmpeg
    ipcMain.handle('ffmpeg:download', async (event) => {
        const webContents = event.sender
        const callback: DownloadProgressCallback = (progress) => {
            webContents.send('ffmpeg:downloadProgress', progress)
        }

        try {
            const result = await downloadFFmpeg(callback)
            return { success: result }
        } catch (error: unknown) {
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })

    // 执行 FFmpeg 命令
    ipcMain.handle('ffmpeg:run', async (event, { args, taskId }: { args: string[]; taskId: string }) => {
        const ffmpegPath = getFFmpegPath()

        // 检查是否已安装
        const installed = await isFFmpegInstalled()
        if (!installed) {
            throw new Error('FFmpeg 未安装，请先调用 download() 进行安装')
        }

        const webContents = event.sender

        return new Promise<void>((resolve, reject) => {
            log.info('[FFmpeg] 执行命令:', ffmpegPath, args.join(' '))

            const ffmpegProcess = spawn(ffmpegPath, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
            })

            activeProcesses.set(taskId, ffmpegProcess)

            let stderrBuffer = ''
            let duration: number | undefined

            // 监听 stderr（FFmpeg 的主要输出）
            ffmpegProcess.stderr?.on('data', (data: Buffer) => {
                const chunk = data.toString()
                stderrBuffer += chunk

                // 解析总时长
                if (!duration) {
                    duration = parseDuration(stderrBuffer)
                }

                // 按行处理
                const lines = chunk.split('\n')
                for (const line of lines) {
                    const progress = parseProgress(line, duration)
                    if (progress) {
                        webContents.send('ffmpeg:progress', { taskId, progress })
                    }
                }
            })

            // 监听退出
            ffmpegProcess.on('close', (code) => {
                activeProcesses.delete(taskId)
                log.info('[FFmpeg] 进程退出, code:', code)

                // code 0: 正常完成
                // code 255: 被信号终止（如 SIGINT/quit），也视为正常退出
                if (code === 0 || code === 255) {
                    resolve()
                } else {
                    // 对于获取媒体信息等操作，stderr 包含关键信息
                    // 即使有退出代码，我们也需要返回 stderr 内容供解析
                    const errorMessage = stderrBuffer.trim() || `FFmpeg 执行失败 (exit code: ${code})`
                    reject(new Error(errorMessage))
                }
            })

            ffmpegProcess.on('error', (error) => {
                activeProcesses.delete(taskId)
                reject(error)
            })
        })
    })

    // 强制终止 FFmpeg 进程
    ipcMain.handle('ffmpeg:kill', async (_, taskId: string) => {
        const process = activeProcesses.get(taskId)
        if (process) {
            process.kill('SIGKILL')
            activeProcesses.delete(taskId)
            return true
        }
        return false
    })

    // 优雅退出 FFmpeg 进程（发送 'q' 到 stdin 或 SIGINT）
    ipcMain.handle('ffmpeg:quit', async (_, taskId: string) => {
        const ffmpegProc = activeProcesses.get(taskId)
        if (ffmpegProc) {
            log.info('[FFmpeg] 停止任务:', taskId)

            // 方式 1: 发送 'q' 命令 (Windows/Mac 通用，但依赖 stdin 连接)
            if (ffmpegProc.stdin && !ffmpegProc.stdin.destroyed) {
                ffmpegProc.stdin.write('q\n')
            }

            // 方式 2: 发送 SIGINT 信号 (Mac/Linux 首选，支持优雅退出)
            // 注意：Windows 上 SIGINT 会强制终止，所以只在非 Windows 平台发送
            if (process.platform !== 'win32') {
                ffmpegProc.kill('SIGINT')
            }

            return true
        }
        return false
    })
}
