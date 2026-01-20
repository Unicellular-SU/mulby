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
        case 'emoji':
            return { type: 'emoji', value: icon.value }
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
    // Emoji 形式 (简单判断：非路径且包含 emoji 字符或长度较短)
    // 这里使用一个简单的正则来尝试匹配单个 emoji，但这很复杂。
    // 作为一个简单的 heuristic，如果字符串很短且非 ASCII，或者由 known emoji regex 匹配
    // 为了简单起见，我们假设如果字符串不包含 url/path 特征且长度 <= 2 (考虑到 surrogate pairs) 或者是特定 emoji 格式
    // 更稳健的方式是尝试匹配 emoji regex。
    // 参考: https://github.com/mathiasbynens/emoji-regex
    // 这里我们使用一个简化的判断：如果只有 1-2 个字符且不是字母数字，或者显式看起来像 emoji
    const isEmoji = (str: string) => {
        const ranges = [
            '\ud83c[\udf00-\udfff]', // U+1F300 to U+1F3FF
            '\ud83d[\udc00-\ude4f]', // U+1F400 to U+1F64F
            '\ud83d[\ude80-\udeff]', // U+1F680 to U+1F6FF
            '\ud83e[\udd00-\uddff]'  // U+1F900 to U+1F9FF
        ];
        if (str.match(new RegExp(ranges.join('|'))) || /\p{Emoji}/u.test(str)) {
            return true
        }
        return false
    }

    if (isEmoji(icon) && icon.length < 10) { // 长度限制以防误判文件名
        return { type: 'emoji', value: icon }
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
