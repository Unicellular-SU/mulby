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

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { McpServerManager } from '../ai/mcp-server'

/**
 * 检查 IPC 调用方是否来自系统窗口（非插件窗口）
 *
 * 策略：只允许从内置 webview（主窗口 / 系统页面窗口 / onboarding 窗口等）发起调用。
 * 插件窗口的 WebContents 会有 'mulby-plugin-id' 属性标记。
 */
function isSystemWindowCaller(event: IpcMainInvokeEvent): boolean {
  const sender = event.sender
  if (sender.isDestroyed()) return false

  // 获取 sender 所属的 BrowserWindow
  const win = BrowserWindow.fromWebContents(sender)
  if (!win) return false

  // 插件窗口会通过 webPreferences.additionalArguments 或自定义属性标记
  // 这里使用更可靠的方式：检查窗口的 URL 是否指向我们自己的渲染器页面
  const url = sender.getURL()

  // 系统窗口加载的是本地 file:// 或 localhost dev server
  // 插件窗口加载的是插件目录下的 HTML 或 data:// URL
  if (url.startsWith('file://') || url.startsWith('http://localhost:') || url.startsWith('about:')) {
    return true
  }

  // 通过 VITE_DEV_SERVER_URL 环境变量加载的开发 URL 也认为是系统窗口
  if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
    return true
  }

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
}
