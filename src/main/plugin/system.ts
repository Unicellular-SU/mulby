import { app } from 'electron'
import * as os from 'os'

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

export class PluginSystem {
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
   */
  getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'): string {
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
}

export const pluginSystem = new PluginSystem()
