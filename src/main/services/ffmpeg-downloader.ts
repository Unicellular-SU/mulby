import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { exec } from 'child_process'
import { promisify } from 'util'

const execPromise = promisify(exec)

/**
 * FFmpeg 下载管理器
 *
 * 负责检测、下载、解压 FFmpeg 二进制文件
 * 下载源:
 * - macOS/Linux: Martin Riedl's FFmpeg Build Server
 * - Windows: BtbN/FFmpeg-Builds (GitHub Releases)
 */

// 根据平台获取下载信息
interface DownloadInfo {
    url: string
    filename: string
    binaryName: string
    extractType: 'zip' | 'tar.xz'
    // macOS zip 直接包含二进制文件（无 bin 子目录）
    directBinary: boolean
}

function getDownloadInfo(): DownloadInfo | null {
    const platform = process.platform
    const arch = process.arch

    if (platform === 'darwin') {
        // macOS - 使用 Martin Riedl's FFmpeg Build Server
        // URL 格式: https://ffmpeg.martin-riedl.de/redirect/latest/macos/{arm64,amd64}/snapshot/ffmpeg.zip
        const archSuffix = arch === 'arm64' ? 'arm64' : 'amd64'
        return {
            url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${archSuffix}/snapshot/ffmpeg.zip`,
            filename: `ffmpeg-macos-${archSuffix}.zip`,
            binaryName: 'ffmpeg',
            extractType: 'zip',
            directBinary: true, // Martin Riedl 的 zip 直接包含 ffmpeg 二进制
        }
    } else if (platform === 'win32') {
        // Windows - 使用 BtbN/FFmpeg-Builds
        return {
            url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
            filename: 'ffmpeg-win64.zip',
            binaryName: 'ffmpeg.exe',
            extractType: 'zip',
            directBinary: false, // BtbN 的 zip 包含 bin 子目录
        }
    } else if (platform === 'linux') {
        // Linux - 使用 Martin Riedl's FFmpeg Build Server
        const archSuffix = arch === 'arm64' ? 'arm64' : 'amd64'
        return {
            url: `https://ffmpeg.martin-riedl.de/redirect/latest/linux/${archSuffix}/snapshot/ffmpeg.zip`,
            filename: `ffmpeg-linux-${archSuffix}.zip`,
            binaryName: 'ffmpeg',
            extractType: 'zip',
            directBinary: true,
        }
    }

    return null
}

/**
 * 获取 FFmpeg 存储目录
 */
export function getFFmpegDir(): string {
    return path.join(app.getPath('userData'), 'ffmpeg')
}

/**
 * 获取 FFmpeg 二进制文件路径
 */
export function getFFmpegPath(): string {
    const info = getDownloadInfo()
    if (!info) return ''
    return path.join(getFFmpegDir(), 'bin', info.binaryName)
}

/**
 * 检查 FFmpeg 是否已安装
 */
export async function isFFmpegInstalled(): Promise<boolean> {
    const ffmpegPath = getFFmpegPath()
    if (!ffmpegPath) return false

    try {
        await fs.promises.access(ffmpegPath, fs.constants.X_OK)
        return true
    } catch {
        return false
    }
}

/**
 * 获取 FFmpeg 版本信息
 */
export async function getFFmpegVersion(): Promise<string | null> {
    const ffmpegPath = getFFmpegPath()
    if (!ffmpegPath) return null

    try {
        const { stdout } = await execPromise(`"${ffmpegPath}" -version`)
        const match = stdout.match(/ffmpeg version (\S+)/)
        return match ? match[1] : null
    } catch {
        return null
    }
}

/**
 * 下载进度回调类型
 */
export type DownloadProgressCallback = (progress: {
    phase: 'downloading' | 'extracting' | 'done'
    percent: number
    downloaded?: number
    total?: number
}) => void

/**
 * 下载文件
 */
async function downloadFile(
    url: string,
    destPath: string,
    onProgress?: DownloadProgressCallback
): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = (currentUrl: string) => {
            const protocol = currentUrl.startsWith('https') ? https : http

            protocol
                .get(currentUrl, { headers: { 'User-Agent': 'Mulby' } }, (response) => {
                    // 处理重定向 (301, 302, 303, 307, 308)
                    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
                        const location = response.headers.location
                        if (location) {
                            // 处理相对 URL（使用当前 URL 作为 base）
                            const redirectUrl = new URL(location, currentUrl).href
                            console.log('[FFmpeg] 重定向到:', redirectUrl)
                            request(redirectUrl)
                            return
                        }
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`下载失败: ${response.statusCode}`))
                        return
                    }

                    const totalSize = parseInt(response.headers['content-length'] || '0', 10)
                    let downloadedSize = 0

                    const fileStream = createWriteStream(destPath)

                    response.on('data', (chunk: Buffer) => {
                        downloadedSize += chunk.length
                        if (onProgress && totalSize > 0) {
                            onProgress({
                                phase: 'downloading',
                                percent: Math.round((downloadedSize / totalSize) * 100),
                                downloaded: downloadedSize,
                                total: totalSize,
                            })
                        }
                    })

                    pipeline(response, fileStream)
                        .then(() => resolve())
                        .catch(reject)
                })
                .on('error', reject)
        }

        request(url)
    })
}

/**
 * 解压 zip 文件 (使用系统命令)
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
    if (process.platform === 'win32') {
        // Windows: 使用 PowerShell
        await execPromise(
            `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`
        )
    } else {
        // macOS / Linux: 使用 unzip
        await execPromise(`unzip -o "${zipPath}" -d "${destDir}"`)
    }
}

/**
 * 解压 tar.xz 文件 (Linux)
 */
async function extractTarXz(tarPath: string, destDir: string): Promise<void> {
    await execPromise(`tar -xf "${tarPath}" -C "${destDir}"`)
}

/**
 * 下载并安装 FFmpeg
 */
export async function downloadFFmpeg(
    onProgress?: DownloadProgressCallback
): Promise<boolean> {
    const info = getDownloadInfo()
    if (!info) {
        console.error('[FFmpeg] 不支持当前平台:', process.platform, process.arch)
        return false
    }

    const ffmpegDir = getFFmpegDir()
    const tempDir = path.join(ffmpegDir, 'temp')
    const downloadPath = path.join(tempDir, info.filename)

    try {
        // 创建目录
        await fs.promises.mkdir(tempDir, { recursive: true })

        console.log('[FFmpeg] 开始下载:', info.url)

        // 下载文件
        await downloadFile(info.url, downloadPath, onProgress)

        console.log('[FFmpeg] 下载完成，开始解压')
        onProgress?.({ phase: 'extracting', percent: 0 })

        // 解压
        if (info.extractType === 'zip') {
            await extractZip(downloadPath, tempDir)
        } else {
            await extractTarXz(downloadPath, tempDir)
        }

        onProgress?.({ phase: 'extracting', percent: 50 })

        const binDir = path.join(ffmpegDir, 'bin')
        // 删除旧的 bin 目录
        await fs.promises.rm(binDir, { recursive: true, force: true })
        // 创建新的 bin 目录
        await fs.promises.mkdir(binDir, { recursive: true })

        if (info.directBinary) {
            // Martin Riedl 格式：zip 直接包含 ffmpeg 二进制文件
            const extractedBinary = path.join(tempDir, info.binaryName)
            const destBinary = path.join(binDir, info.binaryName)

            if (await fs.promises.access(extractedBinary).then(() => true).catch(() => false)) {
                await fs.promises.rename(extractedBinary, destBinary)
                console.log('[FFmpeg] 移动二进制文件:', extractedBinary, '->', destBinary)
            } else {
                throw new Error(`找不到 FFmpeg 二进制文件: ${extractedBinary}`)
            }
        } else {
            // BtbN 格式：包含子目录和 bin 文件夹
            const extractedItems = await fs.promises.readdir(tempDir)
            const extractedDir = extractedItems.find(
                (item) => item.startsWith('ffmpeg') && !item.endsWith('.zip') && !item.endsWith('.tar.xz')
            )

            if (!extractedDir) {
                throw new Error('找不到解压后的 FFmpeg 目录')
            }

            const extractedPath = path.join(tempDir, extractedDir)
            const sourceBin = path.join(extractedPath, 'bin')

            if (await fs.promises.access(sourceBin).then(() => true).catch(() => false)) {
                // 复制 bin 目录中的文件
                const binFiles = await fs.promises.readdir(sourceBin)
                for (const file of binFiles) {
                    await fs.promises.rename(
                        path.join(sourceBin, file),
                        path.join(binDir, file)
                    )
                }
            } else {
                throw new Error(`找不到 bin 目录: ${sourceBin}`)
            }
        }

        onProgress?.({ phase: 'extracting', percent: 90 })

        // 设置可执行权限 (Unix)
        if (process.platform !== 'win32') {
            const ffmpegPath = path.join(binDir, info.binaryName)
            await fs.promises.chmod(ffmpegPath, 0o755)
        }

        // 清理临时文件
        await fs.promises.rm(tempDir, { recursive: true, force: true })

        onProgress?.({ phase: 'done', percent: 100 })

        console.log('[FFmpeg] 安装完成')
        return true
    } catch (error) {
        console.error('[FFmpeg] 安装失败:', error)
        // 清理临时文件
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => { })
        throw error
    }
}

/**
 * 检测或提示安装
 */
export async function ensureFFmpegAvailable(): Promise<{
    available: boolean
    path?: string
    needsDownload?: boolean
}> {
    const installed = await isFFmpegInstalled()

    if (installed) {
        return {
            available: true,
            path: getFFmpegPath(),
        }
    }

    const info = getDownloadInfo()
    if (!info) {
        return {
            available: false,
            needsDownload: false, // 不支持的平台
        }
    }

    return {
        available: false,
        needsDownload: true,
    }
}
