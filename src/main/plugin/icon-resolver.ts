import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { PluginIcon, ResolvedIcon } from '../../shared/types/plugin'

/**
 * 解析图标为可渲染的格式
 * 支持 URL、SVG、本地文件路径
 */
export async function resolveIcon(icon: PluginIcon | undefined, pluginPath: string): Promise<ResolvedIcon | undefined> {
    if (!icon) {
        return undefined
    }

    // 字符串简写形式
    if (typeof icon === 'string') {
        return resolveIconString(icon, pluginPath)
    }

    // 对象形式
    switch (icon.type) {
        case 'url':
            return { type: 'url', value: icon.value }
        case 'svg':
            return { type: 'svg', value: icon.value }
        case 'file':
            return loadIconFile(join(pluginPath, icon.value || 'icon.png'))
        default:
            return undefined
    }
}

// 解析字符串形式的图标
function resolveIconString(icon: string, pluginPath: string): ResolvedIcon | undefined {
    // URL 形式
    if (icon.startsWith('http://') || icon.startsWith('https://')) {
        return { type: 'url', value: icon }
    }
    // SVG 形式
    if (icon.trim().startsWith('<svg')) {
        return { type: 'svg', value: icon }
    }
    // 文件路径形式
    return loadIconFile(join(pluginPath, icon))
}

// 加载本地图标文件并转换为 data URL
function loadIconFile(filePath: string): ResolvedIcon | undefined {
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
