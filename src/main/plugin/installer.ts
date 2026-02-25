import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import extractZip from 'extract-zip'
import { tmpdir } from 'os'

export interface InstallResult {
  success: boolean
  pluginName?: string
  isUpdate?: boolean
  oldVersion?: string
  newVersion?: string
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
    if (!String(filePath).toLowerCase().endsWith('.inplugin')) {
      return { success: false, error: '无效的插件文件格式' }
    }

    if (!existsSync(filePath)) {
      return { success: false, error: '文件不存在' }
    }

    const tempDir = join(tmpdir(), `mulby-${Date.now()}`)

    try {
      // 解压到临时目录验证
      await extractZip(filePath, { dir: tempDir })

      // 读取并验证 manifest
      const manifestPath = join(tempDir, 'manifest.json')
      if (!existsSync(manifestPath)) {
        this.cleanupTemp(tempDir)
        return { success: false, error: '无效的插件包：缺少 manifest.json' }
      }

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      if (!manifest.name || !manifest.version || !manifest.main) {
        this.cleanupTemp(tempDir)
        return { success: false, error: '无效的 manifest.json' }
      }

      const targetDir = join(this.pluginsDir, manifest.name)
      let isUpdate = false
      let oldVersion: string | undefined

      // 检查是否已存在
      if (existsSync(targetDir)) {
        const existingManifestPath = join(targetDir, 'manifest.json')
        if (existsSync(existingManifestPath)) {
          const existingManifest = JSON.parse(readFileSync(existingManifestPath, 'utf-8'))
          oldVersion = existingManifest.version
          isUpdate = true

          // 删除旧版本
          rmSync(targetDir, { recursive: true, force: true })
        }
      }

      // 解压到插件目录
      await extractZip(filePath, { dir: targetDir })
      this.cleanupTemp(tempDir)

      return {
        success: true,
        pluginName: manifest.name,
        isUpdate,
        oldVersion,
        newVersion: manifest.version
      }
    } catch (err) {
      this.cleanupTemp(tempDir)
      const error = err instanceof Error ? err.message : '安装失败'
      return { success: false, error }
    }
  }

  // 清理临时目录
  private cleanupTemp(tempDir: string): void {
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    } catch {}
  }
}
