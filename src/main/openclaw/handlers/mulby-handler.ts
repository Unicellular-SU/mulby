/**
 * Mulby 自定义命令处理器
 *
 * 核心差异化能力 — 让 OpenClaw Agent 远程调用 Mulby 插件生态：
 * - mulby.plugin.list: 列出已安装且已启用的插件
 * - mulby.plugin.invoke: 调用指定插件方法
 * - mulby.search: 触发搜索
 * - mulby.clipboard.get: 获取剪贴板内容
 * - mulby.clipboard.set: 设置剪贴板内容
 */

import { clipboard } from 'electron'
import type { CommandHandler } from '../command-registry'

/** 所需的外部依赖注入 */
export interface MulbyHandlerDeps {
  /** 获取所有已安装的插件列表 */
  getPluginList: () => Array<{
    id: string
    name: string
    description?: string
    version: string
    enabled: boolean
  }>

  /** 调用指定插件的方法 */
  invokePlugin: (pluginId: string, method: string, args: unknown[]) => Promise<unknown>

  /** 桌面搜索入口（可选，不提供则返回提示信息） */
  searchDesktop?: (query: string, limit: number) => Promise<Array<{
    name: string
    path: string
    type?: string
  }>>
}

/**
 * 创建 Mulby 自定义命令处理器
 */
export function createMulbyHandlers(deps: MulbyHandlerDeps): Record<string, { handler: CommandHandler; cap: string; description: string }> {
  return {
    'mulby.plugin.list': {
      cap: 'mulby',
      description: '列出 Mulby 已安装且已启用的插件',
      handler: async () => {
        const plugins = deps.getPluginList()
        return {
          plugins: plugins
            .filter((p) => p.enabled)
            .map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description || '',
              version: p.version
            }))
        }
      }
    },

    'mulby.plugin.invoke': {
      cap: 'mulby',
      description: '调用指定的 Mulby 插件方法',
      handler: async (params) => {
        const pluginId = String(params.pluginId || '').trim()
        if (!pluginId) throw new Error('pluginId is required')

        const method = String(params.method || '').trim()
        if (!method) throw new Error('method is required')

        const args = Array.isArray(params.args) ? params.args : []

        const result = await deps.invokePlugin(pluginId, method, args)
        return result
      }
    },

    'mulby.search': {
      cap: 'mulby',
      description: '使用 Mulby 搜索本地应用和文件',
      handler: async (params) => {
        const query = String(params.query || '').trim()
        if (!query) throw new Error('query is required')
        const limit = typeof params.limit === 'number' ? params.limit : 20

        if (!deps.searchDesktop) {
          return { results: [], message: '搜索功能未启用' }
        }

        const results = await deps.searchDesktop(query, limit)
        return {
          query,
          results
        }
      }
    },

    'mulby.clipboard.get': {
      cap: 'mulby.clipboard',
      description: '获取 Mulby 所在机器的剪贴板内容',
      handler: async () => {
        const text = clipboard.readText()
        const html = clipboard.readHTML()
        return {
          text: text || '',
          html: html || '',
          hasImage: !clipboard.readImage().isEmpty()
        }
      }
    },

    'mulby.clipboard.set': {
      cap: 'mulby.clipboard',
      description: '设置 Mulby 所在机器的剪贴板内容',
      handler: async (params) => {
        const text = String(params.text || '')
        if (!text) throw new Error('text is required')
        clipboard.writeText(text)
        return { ok: true }
      }
    }
  }
}
