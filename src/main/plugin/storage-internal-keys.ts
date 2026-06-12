/**
 * 存储内部键前缀定义
 *
 * 附件元数据（storage.attachment）与加密存储（storage.encrypted）复用业务 KV
 * 同一张 store 表、同一个 namespace，靠键前缀区分。这两类键属于宿主实现细节，
 * 对插件的业务 KV 视角必须不可见：
 *
 * - 遍历类 API（keys / getAll / list）必须过滤内部键，否则插件做导出/导入时
 *   会把 DPAPI/Keychain 加密 blob、附件 meta 混进业务数据（换机器后解不开）
 * - clear() 不得删除内部键，否则附件文件全部孤儿化（getType 变 null、
 *   list 退化 octet-stream）、加密存储永久丢失；附件/加密数据有独立的 remove API
 *
 * 注意：get / getMany / has / set / remove 等精确 key 操作不过滤 ——
 * 插件显式构造内部键只影响自己 namespace 的数据，无越权风险。
 *
 * 详见 docs/apis/storage.md。
 */

/** 附件元数据键前缀（storage.attachment 的 mimeType/size 记录） */
export const ATTACHMENT_META_KEY_PREFIX = '_attachment_meta_:'

/** 加密存储键前缀（storage.encrypted 的密文记录） */
export const ENCRYPTED_KEY_PREFIX = '_encrypted_:'

/** 全部内部键前缀 */
export const INTERNAL_KEY_PREFIXES = [ATTACHMENT_META_KEY_PREFIX, ENCRYPTED_KEY_PREFIX] as const

/** 判断是否为存储内部键（附件 meta / 加密数据） */
export function isInternalStorageKey(key: string): boolean {
    return INTERNAL_KEY_PREFIXES.some(prefix => key.startsWith(prefix))
}

/**
 * SQL WHERE 片段：排除内部键。
 *
 * `_` 在 LIKE 中是单字符通配符，必须用 ESCAPE 转义为字面下划线，
 * 否则形如 `xattachment_metaQ:...` 的业务键也会被误判为内部键。
 */
export const EXCLUDE_INTERNAL_KEYS_SQL =
    "key NOT LIKE '\\_attachment\\_meta\\_:%' ESCAPE '\\' AND key NOT LIKE '\\_encrypted\\_:%' ESCAPE '\\'"
