import { clipboard } from 'electron'
import { EventEmitter } from 'events'
import log from 'electron-log'
import { getNativeBuildAddonPathCandidates } from './native-addon-path'

/**
 * 基于系统 API 的剪贴板监听器
 *
 * 实现原理：
 * - macOS: 使用 NSPasteboard changeCount 检测变化（每 100ms 检查一次）
 * - Windows: 使用 Clipboard Viewer Chain（系统消息）
 * - Linux: 使用 X11 Selection Owner 变化检测
 *
 * 优势：
 * - macOS: 0% CPU（只在变化时触发）
 * - Windows/Linux: 真正的系统事件，零开销
 */

interface NativeClipboardWatcher {
  start(): void
  stop(): void
}

interface NativeClipboardAddon {
  ClipboardWatcher: new (onChange: () => void) => NativeClipboardWatcher
}

// 尝试加载 native addon
let nativeClipboard: NativeClipboardAddon | null = null
try {
  const attempts: Array<{ path: string; error: unknown }> = []

  for (const addonPath of getNativeBuildAddonPathCandidates('clipboard_watcher.node')) {
    try {
      nativeClipboard = require(addonPath) as NativeClipboardAddon
      log.info('[ClipboardWatcher] Native addon loaded successfully from:', addonPath)
      break
    } catch (err) {
      attempts.push({ path: addonPath, error: err })
    }
  }

  if (!nativeClipboard) {
    throw attempts
  }
} catch (err) {
  log.warn('[ClipboardWatcher] Native addon not available, falling back to polling:', err)
}

export class ClipboardWatcher extends EventEmitter {
  private lastChangeTime: number = 0
  private lastContentHash: string = ''
  private isWatching: boolean = false

  // Native watcher
  private nativeWatcher: NativeClipboardWatcher | null = null

  // Fallback polling
  private pollInterval: number = 1000
  private pollTimer: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.lastContentHash = this.getClipboardHash()
    this.lastChangeTime = 0
  }

  private hasClipboardContent(): boolean {
    try {
      if ((clipboard.readText() || '').trim()) return true
      if (!clipboard.readImage().isEmpty()) return true
      if (process.platform === 'darwin') {
        return Boolean(clipboard.read('public.file-url') || clipboard.read('NSFilenamesPboardType'))
      }
      return Boolean(
        clipboard.read('text/uri-list') ||
        clipboard.readBuffer('FileNameW').length > 0
      )
    } catch {
      return false
    }
  }

  /**
   * 获取剪贴板内容哈希
   */
  private getClipboardHash(): string {
    try {
      const text = clipboard.readText()
      const shortText = text.substring(0, 100)
      const hasImage = !clipboard.readImage().isEmpty()
      
      let filePart = ''
      if (process.platform === 'darwin') {
        filePart = (clipboard.read('public.file-url') || clipboard.read('NSFilenamesPboardType')).substring(0, 100)
      } else {
        filePart = (
          clipboard.read('text/uri-list') || 
          clipboard.readBuffer('FileNameW').toString('hex')
        ).substring(0, 100)
      }

      return `${shortText}|${hasImage}|${filePart}`
    } catch {
      return ''
    }
  }

  /**
   * 开始监听
   */
  start() {
    if (this.isWatching) return
    this.isWatching = true
    if (this.hasClipboardContent()) {
      this.markAsChanged()
    }

    // 优先使用 native watcher
    if (nativeClipboard && nativeClipboard.ClipboardWatcher) {
      this.startNativeWatching()
    } else {
      this.startPolling()
    }
  }

  /**
   * 使用 Native API 监听（零开销）
   */
  private startNativeWatching() {
    if (!nativeClipboard) {
      this.startPolling()
      return
    }

    try {
      this.nativeWatcher = new nativeClipboard.ClipboardWatcher(() => {
        this.lastChangeTime = Date.now()
        this.lastContentHash = this.getClipboardHash()
        this.emit('change', { timestamp: this.lastChangeTime })
      })

      this.nativeWatcher.start()

      log.info('✅ [ClipboardWatcher] Using native clipboard monitoring (zero overhead)')
    } catch (err) {
      log.error('❌ [ClipboardWatcher] Native watching failed, falling back to polling:', err)
      this.nativeWatcher = null
      this.startPolling()
    }
  }

  /**
   * 使用轮询方式（fallback）
   */
  private startPolling() {
    log.info('⚠️ [ClipboardWatcher] Using polling mode (1s interval)')

    this.pollTimer = setInterval(() => {
      const currentHash = this.getClipboardHash()

      if (currentHash !== this.lastContentHash) {
        this.lastContentHash = currentHash
        this.lastChangeTime = Date.now()
        this.emit('change', { timestamp: this.lastChangeTime })
      }
    }, this.pollInterval)
  }

  /**
   * 停止监听
   */
  stop() {
    if (!this.isWatching) return
    this.isWatching = false

    // 停止 native watcher
    if (this.nativeWatcher) {
      try {
        this.nativeWatcher.stop()
        this.nativeWatcher = null
      } catch (err) {
        log.error('[ClipboardWatcher] Failed to stop native watcher:', err)
      }
    }

    // 停止轮询
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /**
   * 获取最后变化时间
   */
  getLastChangeTime(): number {
    return this.lastChangeTime
  }

  /**
   * 获取剪贴板年龄
   */
  getClipboardAge(): number {
    return Date.now() - this.lastChangeTime
  }

  /**
   * 检查是否最近变化
   */
  isRecentlyChanged(maxAge: number): boolean {
    return this.getClipboardAge() <= maxAge
  }

  /**
   * 手动标记变化
   */
  markAsChanged() {
    this.lastChangeTime = Date.now()
    this.lastContentHash = this.getClipboardHash()
  }

  /**
   * 检查是否使用 native 模式
   */
  isNativeMode(): boolean {
    return this.nativeWatcher !== null
  }
}
