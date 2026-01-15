import { app, shell, systemPreferences } from 'electron'
import * as os from 'os'
import * as crypto from 'crypto'

export interface SystemInfo {
  platform: NodeJS.Platform
  arch: string
  hostname: string
  username: string
  homedir: string
  tmpdir: string
  cpus: number
  totalmem: number
  freemem: number
  uptime: number
  osVersion: string
  osRelease: string
}

export interface AppInfo {
  name: string
  version: string
  locale: string
  isPackaged: boolean
  userDataPath: string
}

// 路径类型定义
export type PathName =
  | 'home' | 'appData' | 'userData' | 'temp' | 'exe'
  | 'desktop' | 'documents' | 'downloads' | 'music'
  | 'pictures' | 'videos' | 'logs'

export class PluginSystem {
  private _nativeId: string | null = null

  /**
   * 获取系统信息
   */
  getSystemInfo(): SystemInfo {
    return {
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      username: os.userInfo().username,
      homedir: os.homedir(),
      tmpdir: os.tmpdir(),
      cpus: os.cpus().length,
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      uptime: os.uptime(),
      osVersion: os.version(),
      osRelease: os.release()
    }
  }

  /**
   * 获取应用信息
   */
  getAppInfo(): AppInfo {
    return {
      name: app.getName(),
      version: app.getVersion(),
      locale: app.getLocale(),
      isPackaged: app.isPackaged,
      userDataPath: app.getPath('userData')
    }
  }

  /**
   * 获取特定路径
   * 扩展支持 'exe' 和 'logs' 类型
   */
  getPath(name: PathName): string {
    return app.getPath(name)
  }

  /**
   * 获取环境变量
   */
  getEnv(name: string): string | undefined {
    return process.env[name]
  }

  /**
   * 获取系统空闲时间（秒）
   */
  getIdleTime(): number {
    const { powerMonitor } = require('electron')
    return powerMonitor.getSystemIdleTime()
  }

  /**
   * 获取文件/文件夹的系统图标
   * @param filePath 文件路径、扩展名（如 .txt）或 'folder'
   * @returns base64 Data URL 格式的图标
   */
  async getFileIcon(filePath: string): Promise<string> {
    const icon = await app.getFileIcon(filePath, { size: 'normal' })
    return icon.toDataURL()
  }

  /**
   * 获取设备唯一标识
   * 使用机器信息生成稳定的设备 ID
   */
  getNativeId(): string {
    if (this._nativeId) {
      return this._nativeId
    }

    // 使用多个硬件特征生成稳定的设备标识
    const machineInfo = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || '',
      os.totalmem().toString(),
      os.homedir()
    ].join('|')

    this._nativeId = crypto
      .createHash('sha256')
      .update(machineInfo)
      .digest('hex')
      .substring(0, 32)

    return this._nativeId
  }

  /**
   * 判断是否为开发环境
   * 插件应用开发环境：未打包运行
   */
  isDev(): boolean {
    return !app.isPackaged
  }

  /**
   * 判断是否为 macOS
   */
  isMacOS(): boolean {
    return process.platform === 'darwin'
  }

  /**
   * 判断是否为 Windows
   */
  isWindows(): boolean {
    return process.platform === 'win32'
  }

  /**
   * 判断是否为 Linux
   */
  isLinux(): boolean {
    return process.platform === 'linux'
  }

  /**
   * 检测辅助功能权限 (macOS)
   */
  isAccessibilityTrusted(): boolean {
    if (process.platform !== 'darwin') return true
    return systemPreferences.isTrustedAccessibilityClient(false)
  }

  /**
   * 打开辅助功能权限设置页 (macOS)
   */
  openAccessibilitySettings(): boolean {
    if (process.platform !== 'darwin') return false
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    return true
  }
}

export const pluginSystem = new PluginSystem()
