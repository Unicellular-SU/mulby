import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import extractZip from 'extract-zip'
import { tmpdir } from 'os'
import { compareVersions } from './version'

export type InstallAction = 'installed' | 'updated' | 'already-installed' | 'downgrade-blocked'

export interface InstallResult {
  success: boolean
  pluginName?: string
  pluginId?: string
  action?: InstallAction
  isUpdate?: boolean
  oldVersion?: string
  newVersion?: string
  error?: string
  installPath?: string
}

export interface PluginInstallSourceMetadata {
  sourceId?: string
  sourceName?: string
  sourceUrl?: string
  downloadUrl?: string
  publisher?: string
  homepage?: string
  repository?: string
  sha256?: string
  integrityStatus?: 'verified' | 'missing'
  integrityDigest?: string
  downloadedAt?: number
}

export class PluginInstaller {
  private pluginsDir: string

  constructor() {
    this.pluginsDir = join(app.getPath('userData'), 'plugins')
    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true })
    }
  }

  async install(filePath: string, sourceMetadata?: PluginInstallSourceMetadata): Promise<InstallResult> {
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

      const pluginId = String(manifest.id || manifest.name)
      const incomingVersion = String(manifest.version || '')
      const existing = this.findInstalledById(pluginId)

      let isUpdate = false
      let oldVersion: string | undefined
      let action: InstallAction = 'installed'

      if (existing) {
        oldVersion = existing.version
        const compare = compareVersions(incomingVersion, oldVersion)
        if (compare < 0) {
          this.cleanupTemp(tempDir)
          return {
            success: false,
            pluginName: manifest.name,
            pluginId,
            action: 'downgrade-blocked',
            oldVersion,
            newVersion: incomingVersion,
            error: `检测到更高版本已安装（${oldVersion}），不允许降级到 ${incomingVersion}`
          }
        }
        if (compare === 0) {
          this.cleanupTemp(tempDir)
          return {
            success: true,
            pluginName: manifest.name,
            pluginId,
            action: 'already-installed',
            oldVersion,
            newVersion: incomingVersion,
            isUpdate: false
          }
        }

        isUpdate = true
        action = 'updated'
        rmSync(existing.path, { recursive: true, force: true })
      }

      const targetDir = existing?.path || join(this.pluginsDir, manifest.name)

      // 解压到插件目录
      await extractZip(filePath, { dir: targetDir })
      if (sourceMetadata) {
        this.writeInstallMetadata(targetDir, {
          pluginId,
          pluginName: String(manifest.name),
          version: String(manifest.version || '0.0.0'),
          ...sourceMetadata
        })
      }
      this.cleanupTemp(tempDir)

      return {
        success: true,
        pluginName: manifest.name,
        pluginId,
        action,
        isUpdate,
        oldVersion,
        newVersion: manifest.version,
        installPath: targetDir
      }
    } catch (err) {
      this.cleanupTemp(tempDir)
      const error = err instanceof Error ? err.message : '安装失败'
      return { success: false, error }
    }
  }

  private findInstalledById(pluginId: string): { path: string; version: string } | null {
    if (!existsSync(this.pluginsDir)) return null

    const dirs = readdirSync(this.pluginsDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      const pluginPath = join(this.pluginsDir, dir.name)
      const manifestPath = join(pluginPath, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
          id?: string
          name?: string
          version?: string
        }
        const existingId = String(manifest.id || manifest.name || '')
        if (!existingId || existingId !== pluginId) continue
        const version = String(manifest.version || '0.0.0')
        return { path: pluginPath, version }
      } catch {
        // ignore invalid manifest
      }
    }
    return null
  }

  // 清理临时目录
  private cleanupTemp(tempDir: string): void {
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    } catch {}
  }

  private writeInstallMetadata(
    installPath: string,
    payload: PluginInstallSourceMetadata & {
      pluginId: string
      pluginName: string
      version: string
    }
  ): void {
    try {
      writeFileSync(
        join(installPath, '.mulby-install.json'),
        JSON.stringify(
          {
            ...payload,
            installedAt: Date.now()
          },
          null,
          2
        ),
        'utf-8'
      )
    } catch (error) {
      console.warn('[PluginInstaller] Failed to write install metadata:', error)
    }
  }
}
