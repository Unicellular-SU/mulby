import { clipboard } from 'electron'

/**
 * 剪贴板监听服务
 * 用于跟踪剪贴板内容的变化时间
 *
 * 性能优化：
 * 1. 使用更长的检查间隔（1000ms）减少 CPU 占用
 * 2. 只在应用活跃时监听
 * 3. 使用轻量级的文本比较
 */
export class ClipboardMonitor {
  private lastChangeTime: number = 0
  private lastContentHash: string = ''
  private intervalId: NodeJS.Timeout | null = null
  private checkInterval: number = 1000 // 1 秒检查一次，降低性能影响
  private isActive: boolean = false

  constructor() {
    this.lastContentHash = this.getClipboardHash()
    this.lastChangeTime = Date.now()
  }

  /**
   * 获取剪贴板内容的简单哈希（用于快速比较）
   * 只检查文本内容的前 100 个字符，避免大文件的性能问题
   */
  private getClipboardHash(): string {
    try {
      const text = clipboard.readText()
      // 只取前 100 个字符作为哈希，足够检测变化
      const shortText = text.substring(0, 100)

      // 检查是否有图片
      const hasImage = !clipboard.readImage().isEmpty()

      // 组合哈希：文本 + 是否有图片
      return `${shortText}|${hasImage}`
    } catch {
      return ''
    }
  }

  /**
   * 开始监听剪贴板变化
   */
  start() {
    if (this.intervalId) return

    this.isActive = true
    this.intervalId = setInterval(() => {
      if (this.isActive) {
        this.checkClipboard()
      }
    }, this.checkInterval)
  }

  /**
   * 停止监听
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.isActive = false
  }

  /**
   * 暂停监听（不清除定时器，只停止检查）
   */
  pause() {
    this.isActive = false
  }

  /**
   * 恢复监听
   */
  resume() {
    this.isActive = true
  }

  /**
   * 检查剪贴板是否变化
   */
  private checkClipboard() {
    try {
      const currentHash = this.getClipboardHash()

      // 如果内容发生变化，更新时间戳
      if (currentHash !== this.lastContentHash) {
        this.lastContentHash = currentHash
        this.lastChangeTime = Date.now()
      }
    } catch (err) {
      // 忽略错误，避免影响应用运行
    }
  }

  /**
   * 获取剪贴板最后变化时间
   */
  getLastChangeTime(): number {
    return this.lastChangeTime
  }

  /**
   * 获取剪贴板内容的年龄（毫秒）
   */
  getClipboardAge(): number {
    return Date.now() - this.lastChangeTime
  }

  /**
   * 检查剪贴板内容是否在指定时间内变化过
   */
  isRecentlyChanged(maxAge: number): boolean {
    return this.getClipboardAge() <= maxAge
  }

  /**
   * 手动标记剪贴板已变化（用于窗口显示时强制更新）
   */
  markAsChanged() {
    this.lastChangeTime = Date.now()
    this.lastContentHash = this.getClipboardHash()
  }
}
