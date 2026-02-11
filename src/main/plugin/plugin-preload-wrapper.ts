/**
 * 插件 Preload 包装器
 * 
 * 用于生成动态 preload 脚本，支持插件自定义 preload
 * 
 * 工作原理：
 * 1. 先执行 mulby 核心 preload，暴露 window.mulby
 * 2. 再执行插件的自定义 preload，允许访问 Node.js
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

// 缓存生成的 preload 文件路径
const preloadCache = new Map<string, string>()

/**
 * 获取 preload 缓存目录
 */
function getPreloadCacheDir(): string {
    const cacheDir = join(app.getPath('userData'), 'preload-cache')
    if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true })
    }
    return cacheDir
}

/**
 * 生成包装后的 preload 脚本
 * 
 * @param basePreloadPath 核心 preload 路径 (src/preload/index.js)
 * @param pluginPreloadPath 插件自定义 preload 路径
 * @param pluginId 插件 ID (用于生成唯一文件名)
 * @returns 生成的包装 preload 文件路径
 */
export function generateWrappedPreload(
    basePreloadPath: string,
    pluginPreloadPath: string,
    pluginId: string
): string {
    // 检查缓存
    const cacheKey = `${pluginId}:${pluginPreloadPath}`
    const cached = preloadCache.get(cacheKey)
    if (cached && existsSync(cached)) {
        return cached
    }

    // 生成包装脚本
    // 注意：由于 Electron 的 preload 只支持单个脚本，
    // 我们需要生成一个包装脚本来按顺序加载两个 preload
    const wrapperCode = `
// === Mulby 自动生成的 Preload 包装脚本 ===
// 请勿手动修改此文件

(function() {
    'use strict';
    
    // 1. 加载核心 preload (暴露 window.mulby)
    require(${JSON.stringify(basePreloadPath)});
    
    // 2. 加载插件自定义 preload
    try {
        require(${JSON.stringify(pluginPreloadPath)});
    } catch (error) {
        console.error('[Mulby] 插件 preload 加载失败:', error);
    }
})();
`

    // 写入缓存目录
    const cacheDir = getPreloadCacheDir()
    const safePluginId = pluginId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const wrapperPath = join(cacheDir, `${safePluginId}-preload.js`)

    writeFileSync(wrapperPath, wrapperCode, 'utf-8')
    preloadCache.set(cacheKey, wrapperPath)

    console.log(`[Mulby] 生成插件 preload 包装: ${wrapperPath}`)
    return wrapperPath
}

/**
 * 清理过期的 preload 缓存
 */
export function clearPreloadCache(): void {
    preloadCache.clear()
}

/**
 * 获取插件应使用的 preload 路径
 * 
 * @param basePreloadPath 核心 preload 路径
 * @param plugin 插件对象 (包含 manifest 和 path)
 * @returns 最终使用的 preload 路径
 */
export function getPluginPreloadPath(
    basePreloadPath: string,
    plugin: { id: string; path: string; manifest: { preload?: string } }
): string {
    // 如果插件没有自定义 preload，使用核心 preload
    if (!plugin.manifest.preload) {
        return basePreloadPath
    }

    // 构建插件 preload 完整路径
    const pluginPreloadPath = join(plugin.path, plugin.manifest.preload)

    // 检查文件是否存在
    if (!existsSync(pluginPreloadPath)) {
        console.warn(`[Mulby] 插件 preload 文件不存在: ${pluginPreloadPath}`)
        return basePreloadPath
    }

    // 生成包装 preload
    return generateWrappedPreload(basePreloadPath, pluginPreloadPath, plugin.id)
}
