import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  statSync,
  copyFileSync,
  renameSync,
  appendFileSync
} from 'fs'
import { join, dirname, basename, extname, resolve, relative, sep } from 'path'
import { app } from 'electron'
import log from 'electron-log'

// ============================================================
// 文件系统分级保护
// ============================================================
//
// 三级分区策略：
// 🟢 自由区域 — 用户文件，插件可自由读写（不限制）
// 🟡 隔离区域 — 插件私有数据，跨插件不可见
// 🔴 禁止区域 — 系统关键路径，硬性阻断写入/删除
// ============================================================

/**
 * 插件安全错误
 */
export class PluginSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginSecurityError'
  }
}

export interface FileStat {
  name: string
  path: string
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}

// 🔴 系统关键路径黑名单（绝对禁止写入/删除）
const SYSTEM_PROTECTED_PATHS_DARWIN = [
  '/System',
  '/usr',
  '/bin',
  '/sbin',
  '/Library/System',
  '/private/var/db'
]

const SYSTEM_PROTECTED_PATHS_WIN32 = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)'
]

/**
 * 检查目标路径是否为系统保护路径
 * 仅阻断写入和删除操作，读取不限制
 */
function checkSystemProtection(targetPath: string, operation: 'write' | 'delete'): void {
  const resolved = resolve(targetPath)
  const protectedPaths =
    process.platform === 'darwin'
      ? SYSTEM_PROTECTED_PATHS_DARWIN
      : process.platform === 'win32'
        ? SYSTEM_PROTECTED_PATHS_WIN32
        : []

  const isProtected = protectedPaths.some((p) =>
    resolved.toLowerCase().startsWith(p.toLowerCase())
  )

  if (isProtected) {
    const msg = `[PluginSecurity] 操作被阻止：不允许对系统路径 "${resolved}" 执行 ${operation} 操作`
    log.warn(msg)
    throw new PluginSecurityError(msg)
  }
}

/**
 * macOS 和 Windows 默认文件系统大小写不敏感
 * 需要标准化路径后再做 startsWith 比较，防止大小写变体绕过
 */
const IS_CASE_INSENSITIVE_FS = process.platform === 'darwin' || process.platform === 'win32'

/**
 * 标准化路径用于安全比较
 * 在大小写不敏感的文件系统上，统一转换为小写
 */
function normalizePath(p: string): string {
  return IS_CASE_INSENSITIVE_FS ? p.toLowerCase() : p
}

/**
 * 检查跨插件数据访问边界
 * 防止插件 A 通过路径拼接读取/修改/删除插件 B 的私有数据
 */
function checkPluginDataBoundary(
  targetPath: string,
  currentPlugin: string,
  operation: 'read' | 'write' | 'delete'
): void {
  const resolved = resolve(targetPath)
  let pluginDataBase: string
  try {
    pluginDataBase = join(app.getPath('userData'), 'plugin-data')
  } catch {
    // app 未初始化时跳过（单元测试场景）
    return
  }

  // 标准化路径（大小写不敏感文件系统下统一转小写）
  const normalizedResolved = normalizePath(resolved)
  const normalizedBase = normalizePath(pluginDataBase)

  // 仅检查指向 plugin-data 目录的路径
  if (normalizedResolved.startsWith(normalizedBase + sep) || normalizedResolved === normalizedBase) {
    const relativePath = relative(pluginDataBase, resolved)
    const targetPlugin = relativePath.split(sep)[0]

    // 保护 plugin-data 根目录本身：relativePath 为空说明操作的是根目录
    if (!targetPlugin || targetPlugin === '' || targetPlugin === '.') {
      const msg = `[PluginSecurity] 插件 "${currentPlugin}" 尝试 ${operation} 插件数据根目录: ${resolved}`
      log.warn(msg)
      throw new PluginSecurityError(msg)
    }

    // 大小写不敏感比较插件名
    const normalizedTarget = normalizePath(targetPlugin)
    const normalizedCurrent = normalizePath(currentPlugin)
    if (normalizedTarget !== normalizedCurrent) {
      const msg = `[PluginSecurity] 插件 "${currentPlugin}" 尝试 ${operation} 插件 "${targetPlugin}" 的私有数据: ${resolved}`
      log.warn(msg)
      throw new PluginSecurityError(msg)
    }
  }
}

// 审计日志配置
let auditEnabled = false
let auditLogPath = ''

/**
 * 启用文件系统审计日志
 */
export function enableFsAudit(logPath?: string): void {
  auditEnabled = true
  try {
    auditLogPath = logPath || join(app.getPath('userData'), 'logs', 'fs-audit.log')
  } catch {
    auditLogPath = logPath || '/tmp/mulby-fs-audit.log'
  }
  const logDir = dirname(auditLogPath)
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }
}

/**
 * 记录文件操作审计日志
 */
function auditLog(pluginName: string, operation: string, filePath: string): void {
  if (!auditEnabled) return
  try {
    const entry = `[${new Date().toISOString()}] [${pluginName}] ${operation}: ${filePath}\n`
    appendFileSync(auditLogPath, entry)
  } catch {
    // 审计日志写入失败不影响正常操作
  }
}

export class PluginFilesystem {
  /** 当前插件名称（为空表示无插件上下文，仅做系统路径保护） */
  readonly pluginName: string

  /** 插件私有数据根目录 */
  readonly pluginDataRoot: string

  /**
   * @param pluginName 插件名称。传入后启用跨插件隔离保护和专属数据目录。
   *                   不传则仅启用系统路径黑名单保护（用于 IPC 通道等无上下文场景）。
   */
  constructor(pluginName?: string) {
    this.pluginName = pluginName || ''

    // 初始化插件私有数据目录
    if (pluginName) {
      try {
        this.pluginDataRoot = join(app.getPath('userData'), 'plugin-data', pluginName)
        if (!existsSync(this.pluginDataRoot)) {
          mkdirSync(this.pluginDataRoot, { recursive: true })
        }
      } catch {
        this.pluginDataRoot = ''
      }
    } else {
      this.pluginDataRoot = ''
    }
  }

  /**
   * 获取插件私有数据目录下的路径
   * 每个插件有独立的数据目录，互不可见
   */
  getDataPath(...subPaths: string[]): string {
    if (!this.pluginDataRoot) {
      throw new PluginSecurityError('getDataPath 需要插件上下文（pluginName）')
    }
    return join(this.pluginDataRoot, ...subPaths)
  }

  // ============================================================
  // 安全检查 — 系统保护 + 跨插件隔离（读/写/删除全覆盖）
  // ============================================================

  /**
   * 执行读取前的安全检查
   * 读取操作不检查系统路径（允许读取系统文件），但检查跨插件数据隔离
   */
  private checkRead(filePath: string): void {
    if (this.pluginName) {
      checkPluginDataBoundary(filePath, this.pluginName, 'read')
      auditLog(this.pluginName, 'READ', filePath)
    }
  }

  /**
   * 执行写入前的安全检查
   */
  private checkWrite(filePath: string): void {
    checkSystemProtection(filePath, 'write')
    if (this.pluginName) {
      checkPluginDataBoundary(filePath, this.pluginName, 'write')
      auditLog(this.pluginName, 'WRITE', filePath)
    }
  }

  /**
   * 执行删除前的安全检查
   */
  private checkDelete(filePath: string): void {
    checkSystemProtection(filePath, 'delete')
    if (this.pluginName) {
      checkPluginDataBoundary(filePath, this.pluginName, 'delete')
      auditLog(this.pluginName, 'DELETE', filePath)
    }
  }

  // 读取文件（受跨插件隔离检查）
  readFile(filePath: string, encoding?: 'utf-8' | 'base64'): string | Buffer {
    this.checkRead(filePath)
    if (encoding === 'utf-8') {
      return readFileSync(filePath, 'utf-8')
    } else if (encoding === 'base64') {
      return readFileSync(filePath).toString('base64')
    }
    return readFileSync(filePath)
  }

  // 写入文件
  writeFile(
    filePath: string,
    data: string | Buffer | ArrayBuffer,
    encoding?: 'utf-8' | 'base64'
  ): void {
    this.checkWrite(filePath)

    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    if (encoding === 'base64' && typeof data === 'string') {
      writeFileSync(filePath, Buffer.from(data, 'base64'))
    } else {
      if (data instanceof ArrayBuffer) {
        writeFileSync(filePath, Buffer.from(data))
      } else {
        writeFileSync(filePath, data as string | NodeJS.ArrayBufferView)
      }
    }
  }

  // 检查文件是否存在（受跨插件隔离检查）
  exists(filePath: string): boolean {
    this.checkRead(filePath)
    return existsSync(filePath)
  }

  // 删除文件
  unlink(filePath: string): void {
    this.checkDelete(filePath)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }

  // 读取目录（受跨插件隔离检查）
  readdir(dirPath: string): string[] {
    this.checkRead(dirPath)
    if (!existsSync(dirPath)) {
      return []
    }
    return readdirSync(dirPath)
  }

  // 创建目录
  mkdir(dirPath: string): void {
    this.checkWrite(dirPath)
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
  }

  // 获取文件信息（受跨插件隔离检查）
  stat(filePath: string): FileStat | null {
    this.checkRead(filePath)
    if (!existsSync(filePath)) {
      return null
    }
    const stats = statSync(filePath)
    return {
      name: basename(filePath),
      path: filePath,
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      createdAt: stats.birthtimeMs,
      modifiedAt: stats.mtimeMs
    }
  }

  // 复制文件
  copy(src: string, dest: string): void {
    this.checkWrite(dest)
    const destDir = dirname(dest)
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }
    copyFileSync(src, dest)
  }

  // 移动/重命名文件
  move(src: string, dest: string): void {
    this.checkDelete(src)
    this.checkWrite(dest)
    const destDir = dirname(dest)
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }
    renameSync(src, dest)
  }

  // 获取文件扩展名（纯路径操作，无限制）
  extname(filePath: string): string {
    return extname(filePath)
  }

  // 拼接路径（纯路径操作，无限制）
  join(...paths: string[]): string {
    return join(...paths)
  }

  // 获取目录名（纯路径操作，无限制）
  dirname(filePath: string): string {
    return dirname(filePath)
  }

  // 获取文件名（纯路径操作，无限制）
  basename(filePath: string, ext?: string): string {
    return basename(filePath, ext)
  }
}
