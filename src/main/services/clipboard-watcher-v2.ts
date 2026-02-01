import { clipboard } from 'electron'
import { EventEmitter } from 'events'
import path from 'path'
import { app } from 'electron'

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

// 尝试加载 native addon
let nativeClipboard: any = null
try {
  // 开发模式和生产模式的路径不同
  const isDev = !app.isPackaged
  let addonPath: string

  if (isDev) {
    // 开发模式：从项目根目录的 native 文件夹加载
    addonPath = path.join(app.getAppPath(), 'native/build/Release/clipboard_watcher.node')
  } else {
    // 生产模式：从 app.asar.unpacked 加载
    addonPath = path.join(process.resourcesPath, 'native/build/Release/clipboard_watcher.node')
  }

  nativeClipboard = require(addonPath)
  console.log('✅ [ClipboardWatcher] Native addon loaded successfully from:', addonPath)
} catch (err) {
  console.warn('⚠️ [ClipboardWatcher] Native addon not available, falling back to polling')
  console.warn('   Error:', (err as Error).message)
}

export class ClipboardWatcher extends EventEmitter {
  private lastChangeTime: number = 0
  private lastContentHash: string = ''
  private isWatching: boolean = false

  // Native watcher
  private nativeWatcher: any = null

  // Fallback polling
  private pollInterval: number = 1000
  private pollTimer: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.lastContentHash = this.getClipboardHash()
    this.lastChangeTime = Date.now()
  }

  /**
   * 获取剪贴板内容哈希
   */
  private getClipboardHash(): string {
    try {
      const text = clipboard.readText()
      const shortText = text.substring(0, 100)
      const hasImage = !clipboard.readImage().isEmpty()
      return `${shortText}|${hasImage}`
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
    try {
      this.nativeWatcher = new nativeClipboard.ClipboardWatcher(() => {
        this.lastChangeTime = Date.now()
        this.lastContentHash = this.getClipboardHash()
        this.emit('change', { timestamp: this.lastChangeTime })
      })

      this.nativeWatcher.start()

      console.log('✅ [ClipboardWatcher] Using native clipboard monitoring (zero overhead)')
    } catch (err) {
      console.error('❌ [ClipboardWatcher] Native watching failed, falling back to polling:', err)
      this.nativeWatcher = null
      this.startPolling()
    }
  }

  /**
   * 使用轮询方式（fallback）
   */
  private startPolling() {
    console.log('⚠️ [ClipboardWatcher] Using polling mode (1s interval)')

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
        console.error('[ClipboardWatcher] Failed to stop native watcher:', err)
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
