import { shell } from 'electron'
import { existsSync } from 'fs'
import { dirname } from 'path'

export class PluginShell {
  /**
   * 使用系统默认应用打开文件
   * @param path 文件路径
   */
  async openPath(path: string): Promise<string> {
    // Windows AppX/UWP 应用使用 shell: URI 启动
    if (process.platform === 'win32' && path.startsWith('shell:')) {
      await shell.openExternal(path)
      return ''
    }
    if (!existsSync(path)) {
      throw new Error(`File not found: ${path}`)
    }
    return shell.openPath(path)
  }

  /**
   * 使用系统默认浏览器打开 URL
   * @param url URL 地址
   */
  async openExternal(url: string): Promise<void> {
    // 验证 URL 格式
    try {
      new URL(url)
    } catch {
      throw new Error(`Invalid URL: ${url}`)
    }
    await shell.openExternal(url)
  }

  /**
   * 在文件管理器中显示文件
   * macOS: Finder
   * Windows: Explorer
   * Linux: 默认文件管理器
   * @param path 文件路径
   */
  showItemInFolder(path: string): void {
    if (!existsSync(path)) {
      throw new Error(`File not found: ${path}`)
    }
    shell.showItemInFolder(path)
  }

  /**
   * 打开文件所在目录
   * @param path 文件路径
   */
  async openFolder(path: string): Promise<string> {
    const folder = existsSync(path) ? (require('fs').statSync(path).isDirectory() ? path : dirname(path)) : dirname(path)
    return shell.openPath(folder)
  }

  /**
   * 将文件移动到回收站/废纸篓
   * @param path 文件路径
   */
  async trashItem(path: string): Promise<void> {
    if (!existsSync(path)) {
      throw new Error(`File not found: ${path}`)
    }
    await shell.trashItem(path)
  }

  /**
   * 播放系统提示音
   */
  beep(): void {
    shell.beep()
  }
}

export const pluginShell = new PluginShell()
