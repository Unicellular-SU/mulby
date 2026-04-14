/**
 * deep-link.ts — Deep Link 核心路由模块
 *
 * 负责 mulby:// 自定义协议的 URL 解析和路由分发。
 * 胶水层设计：组合 PluginManager、PluginStoreService 和安全确认模块。
 */

import { Notification } from 'electron'
import type { PluginManager } from '../plugin'
import type { PluginStoreService } from '../plugin/store-service'
import {
  MAX_DEEP_LINK_URL_LENGTH,
  type DeepLinkHandleResult,
  type DeepLinkRoute
} from '../../shared/types/deep-link'
import {
  isRateLimited,
  needsConfirmation,
  confirmRunPlugin,
  confirmInstallPlugin,
  showPluginNotFound,
  showDeepLinkError
} from './deep-link-security'

/** 路由回调：打开系统页面（由 index.ts 注入） */
type OpenSystemPageFn = (page: string, options?: {
  settingsSection?: string
  detailsPluginId?: string
}) => void

/** 路由回调：显示主窗口（由 index.ts 注入） */
type ShowMainWindowFn = () => void

/** 路由回调：在搜索框填入查询（由 index.ts 注入） */
type FillSearchFn = (query: string) => void

export interface DeepLinkRouterDeps {
  pluginManager: PluginManager
  storeService: PluginStoreService
  openSystemPage: OpenSystemPageFn
  showMainWindow: ShowMainWindowFn
  fillSearch?: FillSearchFn
}

const PROTOCOL = 'mulby'

/**
 * 安全的 URI 解码，畸形编码（如 %ZZ）返回 null 而非抛出 URIError
 */
function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * Deep Link 路由器
 *
 * 解析 mulby:// URL 并分发到对应的处理逻辑。
 */
export class DeepLinkRouter {
  private deps: DeepLinkRouterDeps

  constructor(deps: DeepLinkRouterDeps) {
    this.deps = deps
  }

  /**
   * 处理传入的 deep link URL
   */
  async handleUrl(url: string): Promise<DeepLinkHandleResult> {
    console.log(`[DeepLink] 收到链接: ${url}`)

    // 基本校验
    if (!url || typeof url !== 'string') {
      return { success: false, action: 'unknown', error: 'URL 为空' }
    }

    if (url.length > MAX_DEEP_LINK_URL_LENGTH) {
      console.warn(`[DeepLink] URL 超长 (${url.length}), 已拒绝`)
      return { success: false, action: 'unknown', error: 'URL 超过最大允许长度' }
    }

    // 解析路由
    const route = this.parseUrl(url)
    if (!route) {
      console.warn(`[DeepLink] 无法解析 URL: ${url}`)
      return { success: false, action: 'unknown', error: '无法解析 URL 格式' }
    }

    // 速率限制
    const rateLimitKey = `${route.action}:${route.pluginId || ''}:${route.featureCode || ''}`
    if (isRateLimited(rateLimitKey)) {
      return { success: false, action: route.action, error: '操作过于频繁，请稍后再试' }
    }

    // 分发路由
    try {
      switch (route.action) {
        case 'plugin/run':
          return await this.handlePluginRun(route)
        case 'plugin/install':
          return await this.handlePluginInstall(route)
        case 'plugin/view':
          return this.handlePluginView(route)
        case 'settings':
          return this.handleSettings(route)
        case 'search':
          return this.handleSearch(route)
        case 'store':
          return this.handleStore()
        default:
          return { success: false, action: 'unknown', error: `未知的路由: ${route.action}` }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[DeepLink] 处理失败:`, error)
      return { success: false, action: route.action, error: message }
    }
  }

  /**
   * 解析 mulby:// URL 为路由对象
   *
   * 支持格式:
   *   mulby://plugin/run/<pluginId>/<featureCode>[?input=xxx]
   *   mulby://plugin/install?id=<pluginId>[&source=xxx&download=xxx...]
   *   mulby://plugin/view/<pluginId>
   *   mulby://settings[/<section>]
   *   mulby://search[?q=xxx]
   *   mulby://store
   */
  private parseUrl(url: string): DeepLinkRoute | null {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }

    // 校验协议
    if (parsed.protocol !== `${PROTOCOL}:`) {
      return null
    }

    // URL 解析: mulby://host/path → host 是第一段, pathname 是后续
    // 实际上 new URL('mulby://plugin/run/xxx') 中 host='plugin', pathname='/run/xxx'
    const host = parsed.hostname || ''
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    const params: Record<string, string> = {}
    parsed.searchParams.forEach((value, key) => {
      params[key] = value
    })

    // 路由匹配
    if (host === 'plugin') {
      const subAction = pathParts[0] // run, install, view
      if (subAction === 'run' && pathParts.length >= 3) {
        const pluginId = safeDecodeURIComponent(pathParts[1])
        const featureCode = safeDecodeURIComponent(pathParts[2])
        if (!pluginId || !featureCode) return null
        return {
          action: 'plugin/run',
          pluginId,
          featureCode,
          params
        }
      }

      if (subAction === 'install') {
        const rawId = pathParts.length >= 2 ? safeDecodeURIComponent(pathParts[1]) : undefined
        const pluginId = params['id'] || rawId
        if (!pluginId) return null
        return {
          action: 'plugin/install',
          pluginId,
          params
        }
      }

      if (subAction === 'view' && pathParts.length >= 2) {
        const pluginId = safeDecodeURIComponent(pathParts[1])
        if (!pluginId) return null
        return {
          action: 'plugin/view',
          pluginId,
          params
        }
      }

      return null
    }

    if (host === 'settings') {
      return {
        action: 'settings',
        section: pathParts[0],
        params
      }
    }

    if (host === 'search') {
      return {
        action: 'search',
        params
      }
    }

    if (host === 'store') {
      return {
        action: 'store',
        params
      }
    }

    return null
  }

  // ====== 路由处理器 ======

  /**
   * 处理 plugin/run 路由
   */
  private async handlePluginRun(route: DeepLinkRoute): Promise<DeepLinkHandleResult> {
    const { pluginId, featureCode, params } = route
    if (!pluginId || !featureCode) {
      return { success: false, action: 'plugin/run', error: '缺少 pluginId 或 featureCode' }
    }

    const plugin = this.deps.pluginManager.get(pluginId)

    if (!plugin) {
      // 插件未安装 → 尝试通过商店安装
      console.log(`[DeepLink] 插件 ${pluginId} 未安装，尝试从商店查找`)
      return await this.handlePluginNotInstalled(route)
    }

    if (!plugin.enabled) {
      await showDeepLinkError(
        `插件「${plugin.manifest.displayName || plugin.manifest.name}」已被禁用`,
        '请在插件管理中启用该插件后再试。'
      )
      return { success: false, action: 'plugin/run', error: '插件已禁用' }
    }

    // 检查 featureCode 是否存在
    const features = this.deps.pluginManager.getFeatures(pluginId)
    const feature = features.find(f => f.code === featureCode)
    if (!feature) {
      await showDeepLinkError(
        `插件「${plugin.manifest.displayName || plugin.manifest.name}」中未找到功能「${featureCode}」`,
        '请检查链接是否正确。'
      )
      return { success: false, action: 'plugin/run', error: `未找到功能: ${featureCode}` }
    }

    // 安全确认
    if (needsConfirmation('plugin/run')) {
      const confirmed = await confirmRunPlugin({
        pluginName: plugin.manifest.displayName || plugin.manifest.name,
        pluginId,
        featureCode,
        input: params['input']
      })
      if (!confirmed) {
        return { success: false, action: 'plugin/run', error: '用户取消' , confirmed: false }
      }
    }

    // 执行插件
    const input = params['input'] || ''
    const result = await this.deps.pluginManager.run(pluginId, featureCode, input || undefined)

    if (result.success) {
      // 如果插件有 UI，显示主窗口
      if (result.hasUI) {
        this.deps.showMainWindow()
      }
      return { success: true, action: 'plugin/run', confirmed: true }
    }

    return { success: false, action: 'plugin/run', error: result.error, confirmed: true }
  }

  /**
   * 处理插件未安装的情况 — 尝试从商店安装并运行
   */
  private async handlePluginNotInstalled(route: DeepLinkRoute): Promise<DeepLinkHandleResult> {
    const { pluginId, featureCode, params } = route
    if (!pluginId) {
      return { success: false, action: route.action, error: '缺少 pluginId' }
    }

    // 从商店查找
    const storeEntry = await this.findPluginInStore(pluginId, params['source'])

    if (!storeEntry) {
      // 没有 download 参数则提示无法找到
      if (!params['download']) {
        await showPluginNotFound(pluginId)
        return { success: false, action: route.action, error: '插件未在商店中找到' }
      }
    }

    // 确定下载信息
    const downloadUrl = params['download'] || storeEntry?.plugin.downloadUrl
    const pluginName = params['name'] || storeEntry?.plugin.displayName || storeEntry?.plugin.name
    const publisher = params['publisher'] || storeEntry?.plugin.publisher || storeEntry?.plugin.author

    if (!downloadUrl) {
      await showPluginNotFound(pluginId)
      return { success: false, action: route.action, error: '无可用的下载地址' }
    }

    // 校验下载 URL 必须为 HTTPS
    try {
      const url = new URL(downloadUrl)
      if (url.protocol !== 'https:') {
        await showDeepLinkError('安全限制', '仅允许通过 HTTPS 协议下载插件。')
        return { success: false, action: route.action, error: '下载 URL 必须为 HTTPS' }
      }
    } catch {
      await showDeepLinkError('无效的下载地址', `下载地址格式不正确: ${downloadUrl}`)
      return { success: false, action: route.action, error: '下载 URL 格式无效' }
    }

    // 确认安装
    const confirmed = await confirmInstallPlugin({
      pluginId,
      pluginName,
      publisher,
      downloadUrl
    })
    if (!confirmed) {
      return { success: false, action: route.action, error: '用户取消安装', confirmed: false }
    }

    // 执行安装
    const installResult = await this.deps.storeService.installFromUrl({
      pluginId,
      downloadUrl,
      sourceId: storeEntry?.sourceId,
      sourceName: storeEntry?.sourceName,
      sourceUrl: storeEntry?.sourceUrl,
      publisher,
      sha256: params['sha256'] || storeEntry?.plugin.sha256
    })

    if (!installResult.success) {
      await showDeepLinkError('安装失败', installResult.error || '未知错误')
      return { success: false, action: route.action, error: installResult.error, confirmed: true }
    }

    // 安装成功通知
    new Notification({
      title: '插件安装成功',
      body: `已安装「${installResult.pluginName || pluginId}」`
    }).show()

    // 如果是从 plugin/run 过来的，安装后自动运行
    if (route.action === 'plugin/run' && featureCode) {
      const input = params['input'] || ''
      const runResult = await this.deps.pluginManager.run(pluginId, featureCode, input || undefined)
      if (runResult.success && runResult.hasUI) {
        this.deps.showMainWindow()
      }
      return { success: runResult.success, action: 'plugin/run', confirmed: true }
    }

    return { success: true, action: route.action, confirmed: true }
  }

  /**
   * 处理 plugin/install 路由
   */
  private async handlePluginInstall(route: DeepLinkRoute): Promise<DeepLinkHandleResult> {
    return await this.handlePluginNotInstalled(route)
  }

  /**
   * 处理 plugin/view 路由（无需确认）
   */
  private handlePluginView(route: DeepLinkRoute): DeepLinkHandleResult {
    const { pluginId } = route
    if (!pluginId) {
      return { success: false, action: 'plugin/view', error: '缺少 pluginId' }
    }

    // 打开插件管理页并定位到该插件
    this.deps.openSystemPage('plugin-manager', {
      detailsPluginId: pluginId
    })

    return { success: true, action: 'plugin/view' }
  }

  /**
   * 处理 settings 路由（无需确认）
   */
  private handleSettings(route: DeepLinkRoute): DeepLinkHandleResult {
    const section = route.section

    // 映射 URL section 到设置页 section
    const sectionMap: Record<string, string> = {
      'general': 'general',
      'super-panel': 'superPanel',
      'shortcuts': 'shortcuts',
      'commands': 'commandQuickLaunch',
      'permissions': 'permissions',
      'security': 'security',
      'developer': 'developer',
      'about': 'about',
      'ai': 'dashboard',
      'ai-settings': 'dashboard'
    }

    const mappedSection = section ? sectionMap[section] : undefined

    if (section && !mappedSection) {
      // 未知的 section，尝试作为页面 ID 直接打开
      this.deps.openSystemPage(section)
    } else {
      this.deps.openSystemPage('settings', {
        settingsSection: mappedSection || 'dashboard'
      })
    }

    return { success: true, action: 'settings' }
  }

  /**
   * 处理 search 路由（无需确认）
   */
  private handleSearch(route: DeepLinkRoute): DeepLinkHandleResult {
    const query = route.params['q'] || ''

    this.deps.showMainWindow()

    if (query && this.deps.fillSearch) {
      this.deps.fillSearch(query)
    }

    return { success: true, action: 'search' }
  }

  /**
   * 处理 store 路由（无需确认）
   */
  private handleStore(): DeepLinkHandleResult {
    this.deps.openSystemPage('plugin-store')
    return { success: true, action: 'store' }
  }

  // ====== 辅助方法 ======

  /**
   * 从已配置的商店源中查找插件
   */
  private async findPluginInStore(
    pluginId: string,
    sourceUrl?: string
  ): Promise<{
    plugin: { name: string; displayName?: string; downloadUrl: string; publisher?: string; author?: string; sha256?: string }
    sourceId: string
    sourceName: string
    sourceUrl: string
  } | null> {
    try {
      const result = await this.deps.storeService.fetchStoreEntries()
      if (!result || !result.entries) return null

      // 优先从指定源查找
      if (sourceUrl) {
        const entry = result.entries.find(e =>
          e.plugin.id === pluginId && e.sourceUrl === sourceUrl
        )
        if (entry) return entry
      }

      // 从所有源查找
      const entry = result.entries.find(e => e.plugin.id === pluginId)
      return entry || null
    } catch (error) {
      console.warn(`[DeepLink] 查找商店插件失败:`, error)
      return null
    }
  }
}
