/**
 * 日志 IPC 处理器
 * 处理渲染进程发送的日志请求
 */
import { ipcMain, BrowserWindow } from 'electron'
import { loggerService, LogEntry } from '../services/logger'

// 存储开发者模式状态的获取器
let getDeveloperModeEnabled: () => boolean = () => false

/**
 * 设置开发者模式状态获取器
 */
export function setDeveloperModeGetter(getter: () => boolean) {
    getDeveloperModeEnabled = getter
}

/**
 * 从 webContents 获取插件 ID
 */
function getPluginIdFromSender(sender: Electron.WebContents): string {
    // 尝试从窗口获取插件信息
    const win = BrowserWindow.fromWebContents(sender)
    if (win) {
        // 窗口标题可能包含插件名称
        const title = win.getTitle()
        if (title && title !== 'InTools') {
            return title
        }
    }

    // 尝试从 URL 解析
    const url = sender.getURL()
    if (url) {
        // 从文件路径解析插件 ID
        // 例如: file:///path/to/plugins/pdf-tools/dist/index.html
        const match = url.match(/plugins\/([^/]+)\//)
        if (match) {
            return match[1]
        }
    }

    return 'unknown'
}

/**
 * 注册日志 IPC 处理器
 */
export function registerLogIpc() {
    // 接收日志写入请求
    ipcMain.on('log:write', (event, level: LogEntry['level'], message: string, args?: unknown[]) => {
        // 只有开发者模式开启时才记录日志
        if (!getDeveloperModeEnabled()) return

        const pluginId = getPluginIdFromSender(event.sender)
        loggerService.write(level, pluginId, message, args)
    })

    // 获取日志列表
    ipcMain.handle('log:getLogs', async (_event, options?: {
        pluginId?: string
        level?: LogEntry['level']
        limit?: number
    }) => {
        return loggerService.getLogs(options)
    })

    // 清除日志
    ipcMain.handle('log:clear', async (_event, pluginId?: string) => {
        await loggerService.clear(pluginId)
        return { success: true }
    })

    // 获取日志目录路径
    ipcMain.handle('log:getLogsDir', () => {
        return loggerService.getLogsDir()
    })

    // 订阅实时日志（通过窗口 ID）
    ipcMain.handle('log:subscribe', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { success: false, error: 'Window not found' }

        const unsubscribe = loggerService.subscribe((entry) => {
            loggerService.broadcastTo(win, entry)
        })

        // 窗口关闭时自动取消订阅
        win.once('closed', unsubscribe)

        return { success: true }
    })
}
