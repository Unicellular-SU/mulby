import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import extractZip from 'extract-zip'
import { tmpdir } from 'os'

export interface InstallResult {
  success: boolean
  pluginName?: string
  error?: string
}

export class PluginInstaller {
  private pluginsDir: string

  constructor() {
    this.pluginsDir = join(app.getPath('userData'), 'plugins')
    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true })
    }
  }

  async install(filePath: string): Promise<InstallResult> {
    if (!filePath.endsWith('.inplugin')) {
      return { success: false, error: '无效的插件文件格式' }
    }

    if (!existsSync(filePath)) {
      return { success: false, error: '文件不存在' }
    }

    try {
      // 解压到临时目录验证
      const tempDir = join(tmpdir(), `intools-${Date.now()}`)
      await extractZip(filePath, { dir: tempDir })

      // 读取并验证 manifest
      const manifestPath = join(tempDir, 'manifest.json')
      if (!existsSync(manifestPath)) {
        return { success: false, error: '无效的插件包：缺少 manifest.json' }
      }

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      if (!manifest.name || !manifest.version || !manifest.main) {
        return { success: false, error: '无效的 manifest.json' }
      }

      // 解压到插件目录
      const targetDir = join(this.pluginsDir, manifest.name)
      await extractZip(filePath, { dir: targetDir })

      return { success: true, pluginName: manifest.name }
    } catch (err) {
      const error = err instanceof Error ? err.message : '安装失败'
      return { success: false, error }
    }
  }
}
