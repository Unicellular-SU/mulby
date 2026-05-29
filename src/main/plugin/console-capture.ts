/**
 * 插件 console 输出捕获
 * 通过 Electron 的 webContents console-message 事件，
 * 在主进程侧主动捕获插件渲染进程中的所有 console 输出。
 *
 * 这是唯一的 console 日志捕获路径（preload 层不再覆写 console），
 * 确保每条日志只记录一次，且 pluginId 始终使用 plugin.id。
 */
import { BrowserWindow } from 'electron'
import { loggerService, LogEntry } from '../services/logger'
import { recordCrashBreadcrumb } from '../services/crash-breadcrumbs'

// Electron console-message 事件的 level 值映射
const CONSOLE_LEVEL_MAP: Record<number, LogEntry['level']> = {
    0: 'debug',   // console.log, console.debug
    1: 'info',    // console.info
    2: 'warn',    // console.warn
    3: 'error'    // console.error
}

/**
 * 后端日志桥注入到插件 DevTools 的消息前缀（零宽字符，devtools 中不可见）。
 * console-capture 检测到该前缀时跳过回写日志，避免后端 stdout/stderr 被记录两次
 * （一次来自 host-manager 的 stdout/stderr 处理器，一次来自此处的 console-message 捕获）。
 */
export const BACKEND_BRIDGE_CONSOLE_MARKER = '\u200b\u200bMULBY_BACKEND\u200b'

const installedConsoleCapture = new Map<number, string>()

/**
 * 为插件窗口安装 console 输出捕获
 * 通过监听 webContents 的 console-message 事件，将插件的所有 console 输出转发到日志系统
 *
 * @param win 插件的 BrowserWindow 实例
 * @param pluginId 插件 ID（使用 plugin.id，与所有路径保持一致）
 */
export function installConsoleCapture(win: BrowserWindow, pluginId: string): void {
    installConsoleCaptureForWebContents(win.webContents, pluginId)
}

/**
 * 为插件 WebContents 安装 console 输出捕获。
 * WebContentsView 架构下插件内容不再直接运行在 BrowserWindow.webContents 中。
 */
export function installConsoleCaptureForWebContents(webContents: Electron.WebContents, pluginId: string): void {
    const webContentsId = webContents.id
    if (installedConsoleCapture.get(webContentsId) === pluginId) {
        return
    }
    installedConsoleCapture.set(webContentsId, pluginId)
    webContents.once('destroyed', () => {
        installedConsoleCapture.delete(webContentsId)
    })

    webContents.on('console-message', (_event, level, message, _line, _sourceId) => {
        // 跳过后端日志桥注入的消息：它们已由 host-manager 的 stdout/stderr 处理器记录过，
        // 这里再写一次会造成日志文件重复。
        if (typeof message === 'string' && message.startsWith(BACKEND_BRIDGE_CONSOLE_MARKER)) {
            return
        }
        const logLevel = CONSOLE_LEVEL_MAP[level] ?? 'debug'
        recordCrashBreadcrumb('plugin:console', {
            pluginId,
            webContentsId,
            level: logLevel,
            message
        })
        loggerService.write(logLevel, pluginId, message)
    })
}
