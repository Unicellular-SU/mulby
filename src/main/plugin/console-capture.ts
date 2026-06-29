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

/**
 * \u7f51\u7edc\u65e5\u5fd7\u6865\u6ce8\u5165\u5230\u63d2\u4ef6 DevTools \u7684\u6d88\u606f\u524d\u7f00\uff08\u96f6\u5bbd\u5b57\u7b26\uff0cdevtools \u4e2d\u4e0d\u53ef\u89c1\uff09\u3002
 * \u7531 setupPluginNetworkBridge \u6ce8\u5165\u7684\u7f51\u7edc\u8bf7\u6c42 console \u5206\u7ec4\u90fd\u5e26\u6b64\u524d\u7f00\uff0c
 * console-capture \u68c0\u6d4b\u5230\u540e\u8df3\u8fc7\u56de\u5199\u65e5\u5fd7\uff0c\u907f\u514d\u53ef\u89c2\u6d4b\u6027\u8f93\u51fa\u6c61\u67d3\u6301\u4e45\u5316\u65e5\u5fd7\u6587\u4ef6\u3002
 */
export const PLUGIN_NETWORK_CONSOLE_MARKER = '\u200b\u200bMULBY_NETWORK\u200b'

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
        // 跳过桥注入的消息：
        // - BACKEND_BRIDGE_CONSOLE_MARKER：后端 stdout/stderr 已由 host-manager 处理器记录过；
        // - PLUGIN_NETWORK_CONSOLE_MARKER：网络可观测性输出，仅用于 DevTools 展示，不应落盘。
        if (typeof message === 'string'
            && (message.startsWith(BACKEND_BRIDGE_CONSOLE_MARKER)
                || message.startsWith(PLUGIN_NETWORK_CONSOLE_MARKER))) {
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
