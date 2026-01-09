import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { PluginManifest, Plugin } from '../../shared/types/plugin'

export class PluginLoader {
  private pluginsDir: string

  constructor(pluginsDir: string) {
    this.pluginsDir = pluginsDir
  }

  // 扫描并加载所有插件
  loadAll(): Plugin[] {
    if (!existsSync(this.pluginsDir)) {
      return []
    }

    const plugins: Plugin[] = []
    const dirs = readdirSync(this.pluginsDir, { withFileTypes: true })

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      const plugin = this.loadPlugin(join(this.pluginsDir, dir.name))
      if (plugin) {
        plugins.push(plugin)
      }
    }

    return plugins
  }

  // 加载单个插件
  loadPlugin(pluginPath: string): Plugin | null {
    const manifestPath = join(pluginPath, 'manifest.json')

    if (!existsSync(manifestPath)) {
      console.warn(`No manifest.json found in ${pluginPath}`)
      return null
    }

    try {
      const content = readFileSync(manifestPath, 'utf-8')
      const manifest = JSON.parse(content) as PluginManifest

      if (!this.validateManifest(manifest)) {
        console.warn(`Invalid manifest in ${pluginPath}`)
        return null
      }

      return {
        manifest,
        path: pluginPath,
        enabled: true
      }
    } catch (err) {
      console.error(`Failed to load plugin from ${pluginPath}:`, err)
      return null
    }
  }

  // 验证 manifest 格式
  private validateManifest(manifest: PluginManifest): boolean {
    const required = ['name', 'version', 'displayName', 'runtime', 'main', 'triggers']
    for (const field of required) {
      if (!(field in manifest)) {
        return false
      }
    }
    if (!['nodejs', 'python'].includes(manifest.runtime)) {
      return false
    }
    return true
  }
}