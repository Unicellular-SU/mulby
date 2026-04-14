/**
 * deep-link-security.ts — Deep Link 安全确认模块
 *
 * 负责外部唤起时的用户确认弹窗和速率限制。
 * 复用 ui-dialog-service 的视觉风格。
 */

import { showInternalMessageBox } from './ui-dialog-service'
import { RATE_LIMIT_INTERVAL_MS, SAFE_ACTIONS, type DeepLinkAction } from '../../shared/types/deep-link'

/** 速率限制记录：key → 上次触发时间 */
const rateLimitMap = new Map<string, number>()

/**
 * 检查速率限制
 * @returns true 表示被限流，应跳过本次操作
 */
export function isRateLimited(key: string): boolean {
  const now = Date.now()
  const lastTime = rateLimitMap.get(key)
  if (lastTime && now - lastTime < RATE_LIMIT_INTERVAL_MS) {
    console.log(`[DeepLink] 速率限制生效，跳过: ${key}`)
    return true
  }
  rateLimitMap.set(key, now)
  return false
}

/**
 * 判断操作是否需要用户确认
 *
 * 无风险操作（打开设置、搜索、商店、查看插件详情）直接放行。
 * 有风险操作（运行插件、安装插件）需弹窗确认。
 */
export function needsConfirmation(action: DeepLinkAction): boolean {
  return !SAFE_ACTIONS.has(action)
}

/**
 * 弹出「运行插件」确认对话框
 */
export async function confirmRunPlugin(opts: {
  pluginName: string
  pluginId: string
  featureCode: string
  input?: string
}): Promise<boolean> {
  const detailParts: string[] = [
    `📦 插件: ${opts.pluginName} (${opts.pluginId})`,
    `🔧 功能: ${opts.featureCode}`
  ]
  if (opts.input) {
    const truncated = opts.input.length > 100 ? opts.input.slice(0, 100) + '...' : opts.input
    detailParts.push(`📝 输入: "${truncated}"`)
  }

  const result = await showInternalMessageBox({
    type: 'question',
    title: 'Mulby — 外部请求',
    message: '外部应用请求运行插件，是否允许？',
    detail: detailParts.join('\n'),
    buttons: ['取消', '允许并运行'],
    defaultId: 0,
    cancelId: 0
  })

  return result.response === 1
}

/**
 * 弹出「安装插件」确认对话框
 */
export async function confirmInstallPlugin(opts: {
  pluginId: string
  pluginName?: string
  publisher?: string
  downloadUrl?: string
}): Promise<boolean> {
  const detailParts: string[] = [
    `📦 插件 ID: ${opts.pluginId}`
  ]
  if (opts.pluginName) {
    detailParts.push(`📛 名称: ${opts.pluginName}`)
  }
  if (opts.publisher) {
    detailParts.push(`👤 发布者: ${opts.publisher}`)
  }
  if (opts.downloadUrl) {
    // 仅展示域名部分，避免过长 URL
    try {
      const host = new URL(opts.downloadUrl).host
      detailParts.push(`🌐 来源: ${host}`)
    } catch {
      detailParts.push(`🌐 来源: (自定义 URL)`)
    }
  }

  const result = await showInternalMessageBox({
    type: 'question',
    title: 'Mulby — 安装请求',
    message: '外部应用请求安装插件，是否允许？',
    detail: detailParts.join('\n'),
    buttons: ['取消', '安装'],
    defaultId: 0,
    cancelId: 0
  })

  return result.response === 1
}

/**
 * 弹出「插件未找到」提示
 */
export async function showPluginNotFound(pluginId: string): Promise<void> {
  await showInternalMessageBox({
    type: 'warning',
    title: 'Mulby — 插件未找到',
    message: `未找到插件「${pluginId}」`,
    detail: '该插件可能尚未发布到已配置的商店源中，请检查链接是否正确。',
    buttons: ['知道了'],
    defaultId: 0,
    cancelId: 0
  })
}

/**
 * 弹出通用错误提示
 */
export async function showDeepLinkError(message: string, detail?: string): Promise<void> {
  await showInternalMessageBox({
    type: 'error',
    title: 'Mulby — 链接处理失败',
    message,
    detail,
    buttons: ['知道了'],
    defaultId: 0,
    cancelId: 0
  })
}
