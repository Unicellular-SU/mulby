import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { PluginManifest, Plugin, PluginIcon, ResolvedIcon } from '../../shared/types/plugin'

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

      const resolvedMain = this.resolveMainEntry(manifest.main, pluginPath)
      if (!resolvedMain) {
        console.warn(`Invalid plugin entry in ${pluginPath}: main file not found (${manifest.main})`)
        return null
      }
      if (resolvedMain !== manifest.main) {
        console.warn(`[PluginLoader] Main entry fallback applied for ${manifest.name}: ${manifest.main} -> ${resolvedMain}`)
        manifest.main = resolvedMain
      }

      const resolvedIcon = this.resolveIcon(manifest.icon, pluginPath)

      // 解析插件 ID：优先使用 manifest.id，否则使用 manifest.name
      const id = manifest.id || manifest.name

      return {
        id,
        manifest,
        path: pluginPath,
        enabled: true,
        resolvedIcon
      }
    } catch (err) {
      console.error(`Failed to load plugin from ${pluginPath}:`, err)
      return null
    }
  }

  // 验证 manifest 格式
  private validateManifest(manifest: PluginManifest): boolean {
    const required = ['name', 'version', 'displayName', 'main', 'features']
    for (const field of required) {
      if (!(field in manifest)) {
        return false
      }
    }
    if (!Array.isArray(manifest.features) || manifest.features.length === 0) {
      return false
    }

    // 校验 cmds 字段常见误用
    for (const feature of manifest.features) {
      if (!Array.isArray(feature.cmds)) continue
      for (const cmd of feature.cmds) {
        if (cmd.type === 'regex') {
          const raw = cmd as unknown as Record<string, unknown>
          // 常见错误：将 keyword 的 "value" 字段误用于 regex（regex 应使用 "match"）
          if (!raw.match && typeof raw.value === 'string') {
            console.warn(
              `[PluginLoader] 插件 "${manifest.name}" 的 regex 命令使用了 "value" 字段，` +
              `应为 "match"。已自动纠正，请修改 manifest.json。`
            )
            raw.match = raw.value
            delete raw.value
          }
          if (!raw.match) {
            console.warn(
              `[PluginLoader] 插件 "${manifest.name}" 的 regex 命令缺少 "match" 字段，该命令将不会匹配任何输入。`
            )
          }
        }
      }
    }

    return true
  }

  private resolveMainEntry(mainEntry: string, pluginPath: string): string | null {
    const declaredPath = join(pluginPath, mainEntry)
    if (existsSync(declaredPath)) {
      return mainEntry
    }

    const basename = String(mainEntry).split(/[/\\]/).pop()
    const candidates = Array.from(new Set([
      basename,
      'main.js',
      'index.js'
    ].filter((item): item is string => Boolean(item && item.length > 0))))

    for (const candidate of candidates) {
      if (existsSync(join(pluginPath, candidate))) {
        return candidate
      }
    }

    return null
  }

  // 解析图标
  private resolveIcon(icon: PluginIcon | undefined, pluginPath: string): ResolvedIcon | undefined {
    if (!icon) {
      // 尝试加载默认图标
      return this.loadIconFile(join(pluginPath, 'icon.png'))
    }

    // 字符串简写形式
    if (typeof icon === 'string') {
      return this.resolveIconString(icon, pluginPath)
    }

    // 对象形式
    switch (icon.type) {
      case 'url':
        return { type: 'url', value: icon.value }
      case 'svg':
        return { type: 'svg', value: icon.value }
      case 'file':
        return this.loadIconFile(join(pluginPath, icon.value || 'icon.png'))
      default:
        return undefined
    }
  }

  // 解析字符串形式的图标
  private resolveIconString(icon: string, pluginPath: string): ResolvedIcon | undefined {
    // URL 形式
    if (icon.startsWith('http://') || icon.startsWith('https://')) {
      return { type: 'url', value: icon }
    }
    // SVG 形式
    if (icon.trim().startsWith('<svg')) {
      return { type: 'svg', value: icon }
    }
    // 文件路径形式
    return this.loadIconFile(join(pluginPath, icon))
  }

  // 加载本地图标文件并转换为 data URL
  private loadIconFile(filePath: string): ResolvedIcon | undefined {
    if (!existsSync(filePath)) {
      return undefined
    }
    try {
      const buffer = readFileSync(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
      const base64 = buffer.toString('base64')
      return { type: 'data-url', value: `data:${mimeType};base64,${base64}` }
    } catch {
      return undefined
    }
  }
}
