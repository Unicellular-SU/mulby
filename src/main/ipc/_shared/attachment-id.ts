/**
 * 附件 id 校验
 *
 * 附件 id 直接作为物理文件名落盘（userData/plugin-attachments/<ns>/<id>），
 * 必须挡住所有跨平台文件名陷阱，保证同一插件在 Windows/macOS/Linux 行为一致：
 *
 * - 路径分隔符与 Windows 保留字符（: * ? " < > |）
 * - 控制字符（\x00-\x1f）
 * - Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，含 `NUL.txt` 扩展名形式）：
 *   Win10 等旧版本上写入 NUL 会写进空设备静默丢数据
 * - 尾点 / 首尾空白：Windows 会静默截断，导致 id 与实际文件名错位
 * - 超长 id：超出文件系统约 255 字节的文件名上限
 * - `.tmp-` 前缀：保留给附件原子写入的临时文件
 */

/** 附件 id 最大长度（UTF-8 字节数，为各文件系统 255 字节上限留余量） */
export const MAX_ATTACHMENT_ID_BYTES = 200

/** 附件原子写入使用的临时文件名前缀（保留前缀，不允许作为附件 id） */
export const ATTACHMENT_TMP_PREFIX = '.tmp-'

/** Windows 保留设备名（不带或带任意扩展名都非法，大小写不敏感） */
const WINDOWS_RESERVED_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i

// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[/\\:*?"<>|\x00-\x1f]/

/**
 * 校验并归一化附件 id。
 *
 * @returns 合法返回原 id，非法返回 null（调用方应拒绝本次操作）
 */
export function normalizeAttachmentId(id: string): string | null {
    const normalized = String(id || '')
    if (!normalized || normalized === '.' || normalized === '..') return null
    if (Buffer.byteLength(normalized, 'utf8') > MAX_ATTACHMENT_ID_BYTES) return null
    if (INVALID_CHARS.test(normalized)) return null
    if (normalized !== normalized.trim()) return null
    if (normalized.endsWith('.')) return null
    if (WINDOWS_RESERVED_DEVICE_NAMES.test(normalized)) return null
    if (normalized.startsWith(ATTACHMENT_TMP_PREFIX)) return null
    return normalized
}
