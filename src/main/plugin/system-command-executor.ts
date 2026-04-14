/**
 * system-command-executor.ts — 内置系统命令执行器
 *
 * 当系统插件的 feature 被触发时，由此模块接管执行。
 * 每个 featureCode 对应一个系统级操作，
 * 复用 Mulby 现有的服务模块（胶水编程原则）。
 */

import { app, shell, clipboard, Notification } from 'electron'
import { exec } from 'child_process'
import { join } from 'path'
import type { InputPayload } from '../../shared/types/plugin'

interface ExecuteContext {
  /** 隐藏主窗口（取色/截图等需要先隐藏搜索框） */
  hideMainWindow?: () => void
  /** 打开系统页面（设置/插件商店等） */
  openSystemPage?: (page: string) => void
}

type CommandResult = { success: boolean; hasUI?: boolean; error?: string }

export class SystemCommandExecutor {
  /**
   * 执行系统命令
   * @param featureCode manifest.json 中定义的 feature code
   * @param input 用户输入
   * @param ctx 执行上下文（窗口管理回调等）
   */
  async execute(
    featureCode: string,
    input?: InputPayload,
    ctx?: ExecuteContext
  ): Promise<CommandResult> {
    try {
      switch (featureCode) {
        // ====== 系统电源管理 ======
        case 'lock-screen':
          return this.lockScreen()
        case 'sleep':
          return this.sleep()
        case 'reboot':
          return this.reboot()
        case 'shutdown':
          return this.shutdown()
        case 'logoff':
          return this.logoff()

        // ====== 屏幕工具 ======
        case 'color-picker':
          return await this.colorPicker(ctx)
        case 'screenshot':
          return await this.screenshot(ctx)

        // ====== 网络/URL ======
        case 'open-url':
          return await this.openUrl(input)

        // ====== Mulby 应用管理 ======
        case 'open-settings':
          return this.openSystemPage('settings', ctx)
        case 'open-plugin-store':
          return this.openSystemPage('plugin-store', ctx)
        case 'open-plugin-manager':
          return this.openSystemPage('plugin-manager', ctx)
        case 'open-ai-settings':
          return this.openSystemPage('ai-settings', ctx)
        case 'open-background-plugins':
          return this.openSystemPage('background-plugins', ctx)
        case 'open-task-scheduler':
          return this.openSystemPage('task-scheduler', ctx)

        // ====== 文件/路径 ======
        case 'open-user-data-dir':
          return await this.openPath(app.getPath('userData'))
        case 'open-logs-dir':
          return await this.openPath(app.getPath('logs'))
        case 'open-plugins-dir':
          return await this.openPath(join(app.getPath('userData'), 'plugins'))

        // ====== 应用控制 ======
        case 'restart-app':
          return this.restartApp()
        case 'quit-app':
          return this.quitApp()

        // ====== 剪贴板辅助 ======
        case 'clear-clipboard':
          return this.clearClipboard()

        default:
          return { success: false, error: `未知的系统命令: ${featureCode}` }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error(`[SystemCommand] 执行 ${featureCode} 失败:`, error)
      return { success: false, error }
    }
  }

  // ====== 系统电源管理 ======

  private lockScreen(): CommandResult {
    const cmd = this.getPlatformCommand({
      darwin: 'pmset displaysleepnow',
      win32: 'rundll32.exe user32.dll,LockWorkStation',
      linux: 'loginctl lock-session || xdg-screensaver lock || gnome-screensaver-command -l'
    })
    if (!cmd) return { success: false, error: '不支持当前平台' }
    this.execCommand(cmd)
    return { success: true }
  }

  private sleep(): CommandResult {
    const cmd = this.getPlatformCommand({
      darwin: 'pmset sleepnow',
      win32: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
      linux: 'systemctl suspend || loginctl suspend'
    })
    if (!cmd) return { success: false, error: '不支持当前平台' }
    this.execCommand(cmd)
    return { success: true }
  }

  private reboot(): CommandResult {
    const cmd = this.getPlatformCommand({
      darwin: 'osascript -e \'tell app "System Events" to restart\'',
      win32: 'shutdown /r /t 0',
      linux: 'systemctl reboot || reboot'
    })
    if (!cmd) return { success: false, error: '不支持当前平台' }
    this.execCommand(cmd)
    return { success: true }
  }

  private shutdown(): CommandResult {
    const cmd = this.getPlatformCommand({
      darwin: 'osascript -e \'tell app "System Events" to shut down\'',
      win32: 'shutdown /s /t 0',
      linux: 'systemctl poweroff || shutdown -h now'
    })
    if (!cmd) return { success: false, error: '不支持当前平台' }
    this.execCommand(cmd)
    return { success: true }
  }

  private logoff(): CommandResult {
    const cmd = this.getPlatformCommand({
      darwin: 'osascript -e \'tell app "System Events" to log out\'',
      win32: 'shutdown /l',
      linux: 'loginctl terminate-user $(whoami) || gnome-session-quit --logout --no-prompt'
    })
    if (!cmd) return { success: false, error: '不支持当前平台' }
    this.execCommand(cmd)
    return { success: true }
  }

  // ====== 屏幕工具 ======

  private async colorPicker(ctx?: ExecuteContext): Promise<CommandResult> {
    // 隐藏主窗口，避免取色时遮挡
    ctx?.hideMainWindow?.()
    // 等待窗口隐藏动画完成
    await new Promise(resolve => setTimeout(resolve, 200))

    const { startColorPick } = await import('./color-pick')
    const result = await startColorPick()
    if (!result) {
      return { success: false, error: '取色已取消' }
    }

    // 将颜色值复制到剪贴板
    clipboard.writeText(result.hex)

    // 显示通知
    new Notification({
      title: '取色成功',
      body: `${result.hex} 已复制到剪贴板`
    }).show()

    return { success: true }
  }

  private async screenshot(ctx?: ExecuteContext): Promise<CommandResult> {
    // 隐藏主窗口，避免截图时遮挡
    ctx?.hideMainWindow?.()
    await new Promise(resolve => setTimeout(resolve, 200))

    const { startRegionCapture } = await import('./region-capture')
    const dataUrl = await startRegionCapture()
    if (!dataUrl) {
      return { success: false, error: '截图已取消' }
    }

    // 将截图写入剪贴板
    const { nativeImage } = await import('electron')
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const image = nativeImage.createFromBuffer(buffer)
    clipboard.writeImage(image)

    new Notification({
      title: '截图成功',
      body: '截图已复制到剪贴板'
    }).show()

    return { success: true }
  }

  // ====== 网络/URL ======

  private async openUrl(input?: InputPayload): Promise<CommandResult> {
    const url = input?.text?.trim()
    if (!url) {
      return { success: false, error: '请输入网址' }
    }

    // 补全协议前缀
    const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`
    await shell.openExternal(fullUrl)
    return { success: true }
  }

  // ====== Mulby 应用管理 ======

  private openSystemPage(page: string, ctx?: ExecuteContext): CommandResult {
    if (ctx?.openSystemPage) {
      ctx.openSystemPage(page)
    } else {
      console.warn(`[SystemCommand] openSystemPage 回调未注入，无法打开: ${page}`)
    }
    // 标记为 UI 运行，阻止 PluginList 在成功后隐藏主窗口
    return { success: true, hasUI: true }
  }

  // ====== 文件/路径 ======

  private async openPath(dirPath: string): Promise<CommandResult> {
    const { existsSync, mkdirSync } = await import('fs')
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
    await shell.openPath(dirPath)
    return { success: true }
  }

  // ====== 应用控制 ======

  private restartApp(): CommandResult {
    app.relaunch()
    app.exit(0)
    return { success: true }
  }

  private quitApp(): CommandResult {
    app.quit()
    return { success: true }
  }

  // ====== 剪贴板辅助 ======

  private clearClipboard(): CommandResult {
    clipboard.clear()
    new Notification({
      title: '剪贴板已清空',
      body: '剪贴板内容已清除'
    }).show()
    return { success: true }
  }

  // ====== 工具函数 ======

  /**
   * 根据当前平台获取对应命令
   */
  private getPlatformCommand(commands: { darwin?: string; win32?: string; linux?: string }): string | null {
    const platform = process.platform as 'darwin' | 'win32' | 'linux'
    return commands[platform] || null
  }

  /**
   * 执行系统命令（fire-and-forget，不阻塞）
   */
  private execCommand(cmd: string): void {
    exec(cmd, (error) => {
      if (error) {
        console.error(`[SystemCommand] 命令执行失败: ${cmd}`, error)
      }
    })
  }
}
