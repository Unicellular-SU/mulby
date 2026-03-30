/**
 * screen.ts — 核心截屏模块（已原生化）
 *
 * 平台策略:
 *   - 优先使用原生模块 (CGWindowListCreateImage / GDI+ BitBlt / X11 XGetImage)
 *   - 原生模块不可用时回退到 Electron desktopCapturer
 *   - 已移除 CaptureWindow 依赖（消除 contextIsolation:false 安全风险）
 */

import { desktopCapturer, screen } from 'electron'
import {
  nativeCaptureScreen,
  nativeCaptureRegion,
  isNativeScreenCaptureAvailable
} from '../services/native-screen-capture'

export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  rotation: number
  isPrimary: boolean
}

export interface CaptureSource {
  id: string
  name: string
  thumbnailDataUrl: string
  displayId?: string
  appIconDataUrl?: string
}

export interface CaptureOptions {
  types?: ('screen' | 'window')[]
  thumbnailSize?: { width: number; height: number }
}

export interface ScreenshotOptions {
  sourceId?: string  // 不指定则截取主屏幕
  format?: 'png' | 'jpeg'
  quality?: number   // jpeg 质量 0-100
}

export interface RecordingOptions {
  sourceId: string
  audio?: boolean
  frameRate?: number
}

export class PluginScreen {
  /**
   * 获取所有显示器信息
   */
  getAllDisplays(): DisplayInfo[] {
    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id

    return displays.map(display => ({
      id: display.id,
      label: display.label || `Display ${display.id}`,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
      isPrimary: display.id === primaryId
    }))
  }

  /**
   * 获取主显示器信息
   */
  getPrimaryDisplay(): DisplayInfo {
    const display = screen.getPrimaryDisplay()
    return {
      id: display.id,
      label: display.label || 'Primary Display',
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
      isPrimary: true
    }
  }

  /**
   * 获取鼠标所在位置的显示器
   */
  getDisplayNearestPoint(point: { x: number; y: number }): DisplayInfo {
    const display = screen.getDisplayNearestPoint(point)
    const primaryId = screen.getPrimaryDisplay().id
    return {
      id: display.id,
      label: display.label || `Display ${display.id}`,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
      isPrimary: display.id === primaryId
    }
  }

  /**
   * 获取鼠标当前位置
   */
  getCursorScreenPoint(): { x: number; y: number } {
    return screen.getCursorScreenPoint()
  }

  /**
   * 获取矩形区域所在的显示器（重叠面积最大的）
   */
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): DisplayInfo {
    const display = screen.getDisplayMatching(rect)
    const primaryId = screen.getPrimaryDisplay().id
    return {
      id: display.id,
      label: display.label || `Display ${display.id}`,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
      isPrimary: display.id === primaryId
    }
  }

  /**
   * 获取可捕获的源（屏幕和窗口）
   */
  async getSources(options: CaptureOptions = {}): Promise<CaptureSource[]> {
    const types = options.types || ['screen', 'window']
    const thumbnailSize = options.thumbnailSize || { width: 150, height: 150 }

    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize,
      fetchWindowIcons: true
    })

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnailDataUrl: source.thumbnail.toDataURL(),
      displayId: source.display_id || undefined,
      appIconDataUrl: source.appIcon ? source.appIcon.toDataURL() : undefined
    }))
  }

  /**
   * 截取屏幕截图
   *
   * 优先使用原生模块（< 20ms），失败时回退到 desktopCapturer。
   * 已移除 CaptureWindow 路径。
   */
  async captureScreen(options: ScreenshotOptions = {}): Promise<Buffer> {
    const format = options.format || 'png'
    const quality = options.quality || 90

    // ===== 策略 1: 原生模块截图 =====
    if (isNativeScreenCaptureAvailable()) {
      // 解析 displayIndex
      const displayIndex = this.resolveDisplayIndex(options.sourceId)

      const buffer = nativeCaptureScreen(displayIndex, format, quality)
      if (buffer) {
        return buffer
      }
      console.warn('[PluginScreen] 原生截图返回空，回退到 desktopCapturer')
    }

    // ===== 策略 2: desktopCapturer fallback =====
    return this.captureScreenFallback(options)
  }

  /**
   * 从 sourceId 解析 displayIndex
   * sourceId 格式: "screen:displayId:0" 或 undefined
   */
  private resolveDisplayIndex(sourceId?: string): number {
    if (!sourceId) return 0

    const parts = sourceId.split(':')
    if (parts[0] === 'screen' && parts.length >= 2) {
      const displayId = parseInt(parts[1])
      const displays = screen.getAllDisplays()
      const index = displays.findIndex(d => d.id === displayId)
      return index >= 0 ? index : 0
    }
    return 0
  }

  /**
   * desktopCapturer 回退方案（保留完整兼容性）
   */
  private async captureScreenFallback(options: ScreenshotOptions = {}): Promise<Buffer> {
    const format = options.format || 'png'
    const quality = options.quality || 90

    let sourceId = options.sourceId
    if (!sourceId) {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 }
      })
      if (sources.length === 0) {
        throw new Error('No screen source available')
      }
      sourceId = sources[0].id
    }

    // 获取对应屏幕的分辨率
    const displays = this.getAllDisplays()
    let display = displays.find(d => String(d.id) === sourceId)
    if (!display) {
      const parts = sourceId!.split(':')
      if (parts[0] === 'screen' && parts.length >= 2) {
        const displayId = parseInt(parts[1])
        display = displays.find(d => d.id === displayId)
      }
    }
    if (!display) {
      display = this.getPrimaryDisplay()
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: {
        width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
        height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
      }
    })
    const source = sources.find(s => s.id === sourceId)
    if (!source) throw new Error('Source not found')

    const image = source.thumbnail
    if (format === 'jpeg') {
      return image.toJPEG(quality)
    }
    return image.toPNG()
  }

  /**
   * 截取指定区域
   *
   * 优先使用原生模块（直接在内存中截取指定矩形，无需全屏再裁剪），
   * 失败时回退到 desktopCapturer + 裁剪。
   */
  async captureRegion(
    region: { x: number; y: number; width: number; height: number },
    options: Omit<ScreenshotOptions, 'sourceId'> = {}
  ): Promise<Buffer> {
    const format = options.format || 'png'
    const quality = options.quality || 90
    const normalizedRegion = normalizeCaptureRegion(region)

    // ===== 策略 1: 原生模块区域截图 =====
    if (isNativeScreenCaptureAvailable()) {
      const buffer = nativeCaptureRegion(
        normalizedRegion.x,
        normalizedRegion.y,
        normalizedRegion.width,
        normalizedRegion.height,
        format,
        quality
      )
      if (buffer) {
        return buffer
      }
      console.warn('[PluginScreen] 原生区域截图返回空，回退到 desktopCapturer')
    }

    // ===== 策略 2: desktopCapturer + 裁剪 fallback =====
    return this.captureRegionFallback(normalizedRegion, format, quality)
  }

  /**
   * desktopCapturer 区域截图回退方案
   */
  private async captureRegionFallback(
    normalizedRegion: { x: number; y: number; width: number; height: number },
    format: 'png' | 'jpeg',
    quality: number
  ): Promise<Buffer> {
    const display = screen.getDisplayMatching(normalizedRegion)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
        height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
      }
    })

    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0]
    if (!source) {
      throw new Error('No screen source available')
    }

    const image = source.thumbnail
    const imageSize = image.getSize()
    if (imageSize.width <= 0 || imageSize.height <= 0) {
      throw new Error('Invalid screen source thumbnail size')
    }

    const logicalLeft = Math.max(normalizedRegion.x, display.bounds.x)
    const logicalTop = Math.max(normalizedRegion.y, display.bounds.y)
    const logicalRight = Math.min(normalizedRegion.x + normalizedRegion.width, display.bounds.x + display.bounds.width)
    const logicalBottom = Math.min(normalizedRegion.y + normalizedRegion.height, display.bounds.y + display.bounds.height)
    if (logicalRight <= logicalLeft || logicalBottom <= logicalTop) {
      throw new Error('Selected region is outside the current display bounds')
    }

    const scaleFactor = display.scaleFactor || 1
    const rawCropX = Math.round((logicalLeft - display.bounds.x) * scaleFactor)
    const rawCropY = Math.round((logicalTop - display.bounds.y) * scaleFactor)
    const rawCropWidth = Math.max(1, Math.round((logicalRight - logicalLeft) * scaleFactor))
    const rawCropHeight = Math.max(1, Math.round((logicalBottom - logicalTop) * scaleFactor))
    const cropX = clampInteger(rawCropX, 0, Math.max(0, imageSize.width - 1))
    const cropY = clampInteger(rawCropY, 0, Math.max(0, imageSize.height - 1))
    const maxCropWidth = Math.max(1, imageSize.width - cropX)
    const maxCropHeight = Math.max(1, imageSize.height - cropY)
    const cropWidth = Math.min(rawCropWidth, maxCropWidth)
    const cropHeight = Math.min(rawCropHeight, maxCropHeight)
    const cropped = image.crop({
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight
    })

    if (format === 'jpeg') {
      return cropped.toJPEG(quality)
    }
    return cropped.toPNG()
  }

  /**
   * 获取录屏所需的 MediaStream 约束配置
   * 注意：实际的 MediaStream 需要在渲染进程中创建
   */
  getMediaStreamConstraints(options: RecordingOptions): object {
    return {
      audio: options.audio ? {
        mandatory: {
          chromeMediaSource: 'desktop'
        }
      } : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: options.sourceId,
          maxFrameRate: options.frameRate || 30
        }
      }
    }
  }
}

function normalizeCaptureRegion(region: { x: number; y: number; width: number; height: number }): {
  x: number
  y: number
  width: number
  height: number
} {
  const rawX = Number.isFinite(region.x) ? region.x : 0
  const rawY = Number.isFinite(region.y) ? region.y : 0
  const rawWidth = Number.isFinite(region.width) ? region.width : 0
  const rawHeight = Number.isFinite(region.height) ? region.height : 0
  const x = rawWidth >= 0 ? rawX : rawX + rawWidth
  const y = rawHeight >= 0 ? rawY : rawY + rawHeight
  const width = Math.max(1, Math.round(Math.abs(rawWidth)))
  const height = Math.max(1, Math.round(Math.abs(rawHeight)))

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (max < min) return min
  const rounded = Math.round(value)
  if (rounded <= min) return min
  if (rounded >= max) return max
  return rounded
}
// 单例
export const pluginScreen = new PluginScreen()
