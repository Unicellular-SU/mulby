/**
 * 日志 IPC 处理器
 * 处理渲染进程发送的日志请求
 */
import { ipcMain } from 'electron'
import { loggerService, LogEntry } from '../services/logger'
import { windowFromWebContents } from '../services/webcontents-registry'

/**
 * 从 webContents 获取插件 ID
 * 优先从 URL 路径提取 plugin.id（最准确），回退到窗口标题
 */
function getPluginIdFromSender(sender: Electron.WebContents): string {
    // 优先从 URL 路径解析插件 ID（这是最准确的，始终返回 plugin.id）
    // 例如: file:///path/to/plugins/pdf-tools/dist/index.html
    const url = sender.getURL()
    if (url) {
        const match = url.match(/plugins\/([^/]+)\//)
        if (match) {
            return match[1]
        }
    }

    // 回退：从窗口标题获取（注意：这可能是 displayName 而非 id）
    const win = windowFromWebContents(sender)
    if (win) {
        const title = win.getTitle()
        if (title && title !== 'Mulby') {
            return title
        }
    }

    return 'unknown'
}

/**
 * 注册日志 IPC 处理器
 */
export function registerLogIpc() {
    // 接收日志写入请求（始终记录，日志查看器是发布模式下的调试工具）
    ipcMain.on('log:write', (event, level: LogEntry['level'], message: string, args?: unknown[]) => {
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
        const win = windowFromWebContents(event.sender)
        if (!win) return { success: false, error: 'Window not found' }

        const unsubscribe = loggerService.subscribe((entry) => {
            loggerService.broadcastTo(win, entry)
        })

        // 窗口关闭时自动取消订阅
        win.once('closed', unsubscribe)

        return { success: true }
    })
}
