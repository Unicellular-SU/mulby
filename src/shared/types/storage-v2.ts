/**
 * Storage V2 类型定义
 *
 * 在现有 storage API 上扩展的高级能力：分页遍历、批量操作、CAS 并发控制、事务、追加写、变更订阅。
 * 供主进程、渲染进程、插件类型三层共享。
 */

// ====== 错误码 ======
export type StorageErrorCode =
  | 'E_CONFLICT'         // CAS 版本冲突
  | 'E_NOT_FOUND'        // 键不存在
  | 'E_QUOTA_EXCEEDED'   // 空间不足
  | 'E_INVALID_KEY'      // key 不合法
  | 'E_INVALID_VALUE'    // value 不可序列化
  | 'E_TX_ABORTED'       // 事务失败已回滚
  | 'E_RATE_LIMITED'     // 高频写入被限流
  | 'E_UNSUPPORTED'      // 当前平台不支持某能力

// ====== list：按前缀分页遍历 ======

export interface StorageListOptions {
  /** 键前缀过滤（如 'chat:s:' 可遍历所有会话） */
  prefix?: string
  /** 分页游标：从该 key 之后开始（不含该 key 本身） */
  startsAfter?: string
  /** 每页数量，默认 50，上限 500 */
  limit?: number
  /** 排序方向，默认 'asc' */
  order?: 'asc' | 'desc'
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
}

export interface StorageListItem {
  key: string
  /** value 的字节数 */
  size: number
  updatedAt: number
  version: number
}

export interface StorageListResult {
  items: StorageListItem[]
  /** 下一页游标（传入下次的 startsAfter），undefined 表示已到末尾 */
  nextCursor?: string
}

// ====== getMany：批量读取 ======

export interface StorageGetManyItem {
  key: string
  found: boolean
  value?: unknown
  version?: number
  updatedAt?: number
}

// ====== setMany：批量写入 ======

export interface StorageSetManyItem {
  key: string
  value: unknown
  /** CAS：期望的版本号。null 表示仅在 key 不存在时写入。undefined 表示无条件写入 */
  expectedVersion?: number | null
}

export interface StorageSetManyOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
  /** 是否原子执行（默认 true：任一失败则全回滚） */
  atomic?: boolean
}

export interface StorageSetManyResultItem {
  key: string
  ok: boolean
  version?: number
  error?: StorageErrorCode
}

export interface StorageSetManyResult {
  success: boolean
  results: StorageSetManyResultItem[]
}

// ====== getMeta：获取值 + 元数据 ======

export interface StorageMetaResult {
  found: boolean
  value?: unknown
  version?: number
  updatedAt?: number
}

// ====== setWithVersion：CAS 写入 ======

export interface StorageSetVersionOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
  /** CAS：期望的版本号。null 表示仅在 key 不存在时写入。undefined 表示无条件写入 */
  expectedVersion?: number | null
}

export interface StorageSetVersionResult {
  ok: boolean
  /** 写入成功后的新版本号 */
  version?: number
  /** 冲突时返回当前版本号 */
  conflict?: { currentVersion: number }
}

// ====== removeWithVersion：CAS 删除 ======

export interface StorageRemoveVersionOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
  /** CAS：期望的版本号 */
  expectedVersion?: number
}

export interface StorageRemoveVersionResult {
  ok: boolean
  error?: StorageErrorCode
}

// ====== transaction：原子事务 ======

export interface StorageTransactionOp {
  op: 'set' | 'remove'
  key: string
  value?: unknown
  /** CAS：期望的版本号。null 表示仅在 key 不存在时写入 */
  expectedVersion?: number | null
}

export interface StorageTransactionOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
}

export interface StorageTransactionResult {
  success: boolean
  /** 成功提交的操作数（失败时为 0） */
  committed: number
  /** 冲突键列表（仅失败时返回） */
  conflicts?: Array<{ key: string; currentVersion: number }>
}

// ====== append：追加写入（JSON 数组） ======

export interface StorageAppendOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
  /** 自动滚动窗口：数组超过该长度时，从头部截断 */
  maxItems?: number
}

export interface StorageAppendResult {
  ok: boolean
  /** 追加后数组的新长度 */
  newLength: number
  /** 新版本号 */
  version: number
}

// ====== watch：变更订阅 ======

export interface StorageWatchOptions {
  /** 命名空间过滤 */
  namespace?: string
  /** 键前缀过滤 */
  prefix?: string
}

export interface StorageWatchEvent {
  type: 'set' | 'remove' | 'clear'
  key: string
  namespace: string
  version?: number
  updatedAt: number
}
