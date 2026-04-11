/**
 * MCP Server IPC Handlers
 *
 * 暴露 MCP Server 管理接口给渲染进程：
 * - 状态查询
 * - 启动/停止/重启
 * - Token 管理
 * - 客户端配置示例
 *
 * 安全边界：
 * 这些接口是宿主级能力，仅允许从系统窗口（主窗口/系统页面窗口）调用。
 * 插件 renderer 虽然能看到 window.mulby.ai.mcpServer API 入口（因为共享同一个 preload），
 * 但 IPC 层会检查 sender 来源并拒绝非系统窗口的调用。
 */

import { BrowserWindow, app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join, normalize } from 'path'
import { fileURLToPath } from 'node:url'
import type { McpServerManager } from '../ai/mcp-server'

/**
 * 应用 renderer 目录的绝对路径（归一化）。
 * 系统窗口加载的 HTML 一定位于此目录下。
 */
const APP_RENDERER_DIR = normalize(join(__dirname, '..', 'renderer'))

/**
 * 用户插件安装目录。
 * 插件窗口加载的 HTML 位于此目录下，不应被视为系统窗口。
 */
const USER_PLUGINS_DIR = normalize(join(app.getPath('userData'), 'plugins'))

/**
 * 从 file:// URL 中提取本地路径。
 * 使用 Node.js 内置 fileURLToPath 正确处理跨平台差异：
 * - Windows: file:///C:/foo → C:\foo（而非 /C:/foo）
 * - macOS/Linux: file:///home/foo → /home/foo
 */
function fileUrlToLocalPath(fileUrl: string): string | null {
  try {
    return fileURLToPath(fileUrl)
  } catch {
    return null
  }
}

/**
 * 检查 IPC 调用方是否来自系统窗口（非插件窗口）
 *
 * 策略：只允许从内置 webview（主窗口 / 系统页面窗口 / onboarding 窗口等）发起调用。
 * 插件窗口虽然也通过 file:// 加载，但其路径指向 userData/plugins/ 目录，
 * 而非应用自身的 renderer/ 目录。通过路径前缀匹配来区分。
 */
function isSystemWindowCaller(event: IpcMainInvokeEvent): boolean {
  const sender = event.sender
  if (sender.isDestroyed()) return false

  // 获取 sender 所属的 BrowserWindow
  const win = BrowserWindow.fromWebContents(sender)
  if (!win) return false

  const url = sender.getURL()

  // 开发模式：通过 VITE_DEV_SERVER_URL 或 localhost 加载的系统窗口
  if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
    return true
  }
  if (url.startsWith('http://localhost:')) {
    return true
  }

  // about:blank 等内部页面视为系统窗口
  if (url.startsWith('about:')) {
    return true
  }

  // file:// URL：需要区分系统 renderer 和插件目录
  if (url.startsWith('file://')) {
    const localPath = fileUrlToLocalPath(url)
    if (!localPath) return false

    const normalizedPath = normalize(localPath)

    // 位于插件目录下 → 拒绝
    if (normalizedPath.startsWith(USER_PLUGINS_DIR)) {
      return false
    }

    // 位于应用 renderer 目录下 → 允许
    if (normalizedPath.startsWith(APP_RENDERER_DIR)) {
      return true
    }

    // 其他 file:// 路径（如 data: URL 产生的子窗口）→ 拒绝
    return false
  }

  // data:// 等其他协议 → 拒绝
  return false
}

/**
 * 安全拒绝：插件窗口调用宿主级 API 时返回错误
 */
function rejectPluginAccess(channel: string): never {
  throw new Error(`[MCP-Server] Access denied: '${channel}' is a system-only API`)
}

/**
 * 注册 MCP Server IPC 处理器
 */
export function registerMcpServerHandlers(manager: McpServerManager): void {
  // 获取运行状态（只读，允许系统窗口）
  ipcMain.handle('ai:mcpServer:getState', async (event) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:getState')
    return manager.getState()
  })

  // 启动 MCP Server
  ipcMain.handle('ai:mcpServer:start', async (event) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:start')
    await manager.start()
    return manager.getState()
  })

  // 停止 MCP Server
  ipcMain.handle('ai:mcpServer:stop', async (event) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:stop')
    await manager.stop()
    return manager.getState()
  })

  // 重启 MCP Server
  ipcMain.handle('ai:mcpServer:restart', async (event) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:restart')
    await manager.restart()
    return manager.getState()
  })

  // 重新生成 Token（敏感操作）
  ipcMain.handle('ai:mcpServer:regenerateToken', async (event) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:regenerateToken')
    const newToken = manager.regenerateToken()
    return { token: newToken }
  })

  // 获取已注册工具列表
  ipcMain.handle('ai:mcpServer:getTools', async (event) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:getTools')
    return manager.getTools()
  })

  // 获取客户端配置示例（包含 Token，敏感操作）
  ipcMain.handle('ai:mcpServer:getClientConfig', async (event) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:getClientConfig')
    return manager.getClientConfigExample()
  })

  // 刷新工具列表
  ipcMain.handle('ai:mcpServer:refreshTools', async (event) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:refreshTools')
    manager.refreshTools()
    return manager.getState()
  })

  // 获取 MCP Server 配置（token/port/enabled + stdioBridgePath）
  ipcMain.handle('ai:mcpServer:getConfig', async (event) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:getConfig')
    const config = manager.getConfig()
    return {
      ...config,
      stdioBridgePath: manager.getStdioBridgePath()
    }
  })

  // 更新端口号（需要重启生效）
  ipcMain.handle('ai:mcpServer:updatePort', async (event, port: number) => {
    if (!isSystemWindowCaller(event)) rejectPluginAccess('ai:mcpServer:updatePort')
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('端口号必须在 1024-65535 之间')
    }
    manager.updatePort(port)
    return manager.getState()
  })
}
