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
  nativeGetWindowBounds,
  resolveNativeDisplayIndex,
  isNativeScreenCaptureAvailable
} from '../services/native-screen-capture'
import {
  createPublicCaptureSource,
  normalizeCaptureBounds,
  type CaptureBounds,
  type PublicCaptureSource
} from '../services/capture-source-utils'
import type { ElectronDisplayLike } from '../services/screen-coordinate-utils'
import { SCREEN_CAPTURE_THUMBNAIL_SIZE } from '../constants/window-defaults'
import { createSystemPermissionDeniedError } from './media-permission-policy'
import log from 'electron-log'

export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  rotation: number
  isPrimary: boolean
}

export type { CaptureBounds }

export type CaptureSource = PublicCaptureSource

export interface CaptureOptions {
  types?: ('screen' | 'window')[]
  thumbnailSize?: { width: number; height: number }
  fetchWindowIcons?: boolean
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

interface DesktopCapturerLike {
  getSources(options: Electron.SourcesOptions): Promise<Electron.DesktopCapturerSource[]>
}

interface NativeCaptureLike {
  isAvailable(): boolean
  resolveDisplayIndex(display: ElectronDisplayLike): number | null
  captureScreen(displayIndex: number, format: 'png' | 'jpeg', quality: number): Buffer | null
  captureRegion(
    x: number,
    y: number,
    width: number,
    height: number,
    format: 'png' | 'jpeg',
    quality: number
  ): Buffer | null
}

interface ScreenApiLike {
  getAllDisplays(): Electron.Display[]
  getPrimaryDisplay(): Electron.Display
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): Electron.Display
}

interface PluginScreenDependencies {
  desktopCapturer?: DesktopCapturerLike
  getWindowBounds?: (sourceId: string) => CaptureBounds | null
  nativeCapture?: NativeCaptureLike
  screen?: ScreenApiLike
}

const defaultNativeCapture: NativeCaptureLike = {
  isAvailable: isNativeScreenCaptureAvailable,
  resolveDisplayIndex: resolveNativeDisplayIndex,
  captureScreen: nativeCaptureScreen,
  captureRegion: nativeCaptureRegion
}

export class PluginScreen {
  constructor(private readonly dependencies: PluginScreenDependencies = {}) {}

  private get desktopCapturer(): DesktopCapturerLike {
    const capturer = this.dependencies.desktopCapturer || desktopCapturer
    if (!capturer) {
      throw new Error('Electron desktopCapturer is unavailable')
    }
    return capturer
  }

  private get nativeCapture(): NativeCaptureLike {
    return this.dependencies.nativeCapture || defaultNativeCapture
  }

  private get screenApi(): ScreenApiLike {
    return this.dependencies.screen || screen
  }

  /**
   * 获取所有显示器信息
   */
  getAllDisplays(): DisplayInfo[] {
    const displays = this.screenApi.getAllDisplays()
    const primaryId = this.screenApi.getPrimaryDisplay().id

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
    const display = this.screenApi.getPrimaryDisplay()
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
   * 屏幕物理坐标转 DIP 坐标
   */
  screenToDipPoint(point: { x: number; y: number }): { x: number; y: number } {
    return screen.screenToDipPoint(point)
  }

  /**
   * DIP 坐标转屏幕物理坐标
   */
  dipToScreenPoint(point: { x: number; y: number }): { x: number; y: number } {
    return screen.dipToScreenPoint(point)
  }

  /**
   * 屏幕物理区域转 DIP 区域
   */
  screenToDipRect(rect: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
    return screen.screenToDipRect(null as unknown as Electron.BrowserWindow, rect) as { x: number; y: number; width: number; height: number }
  }

  /**
   * DIP 区域转屏幕物理区域
   */
  dipToScreenRect(rect: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
    return screen.dipToScreenRect(null as unknown as Electron.BrowserWindow, rect) as { x: number; y: number; width: number; height: number }
  }

  /**
   * 获取可捕获的源（屏幕和窗口）
   */
  async getSources(options: CaptureOptions = {}): Promise<CaptureSource[]> {
    const types = options.types || ['screen', 'window']
    const thumbnailSize = options.thumbnailSize || { width: SCREEN_CAPTURE_THUMBNAIL_SIZE, height: SCREEN_CAPTURE_THUMBNAIL_SIZE }
    const fetchWindowIcons = options.fetchWindowIcons ?? types.includes('window')

    const sources = await withScreenPermissionErrorMapping(() => this.desktopCapturer.getSources({
      types,
      thumbnailSize,
      fetchWindowIcons
    }))

    return sources.map(source => createPublicCaptureSource(
      source,
      this.resolveWindowBounds(source.id)
    ))
  }

  /**
   * 获取指定窗口捕获源的当前窗口边界。
   */
  async getWindowBounds(sourceId: string): Promise<CaptureBounds | null> {
    return this.resolveWindowBounds(sourceId)
  }

  private resolveWindowBounds(sourceId: string): CaptureBounds | null {
    const resolver = this.dependencies.getWindowBounds || nativeGetWindowBounds
    return normalizeCaptureBounds(resolver(sourceId))
  }

  /**
   * 截取屏幕截图
   *
   * 优先使用原生模块（< 20ms），失败时回退到 desktopCapturer。
   * 原生路径只支持整屏捕获：窗口等非屏幕源一律走 desktopCapturer，
   * 避免旧实现把窗口 sourceId 静默截成主屏。
   */
  async captureScreen(options: ScreenshotOptions = {}): Promise<Buffer> {
    const format = options.format || 'png'
    const quality = options.quality || 90

    // ===== 策略 1: 原生模块截图（仅屏幕源） =====
    if (this.nativeCapture.isAvailable() && isScreenLikeSourceId(options.sourceId)) {
      const display = await this.resolveTargetDisplay(options.sourceId)
      const displayIndex = display ? this.nativeCapture.resolveDisplayIndex(display) : null
      if (displayIndex !== null) {
        const buffer = this.nativeCapture.captureScreen(displayIndex, format, quality)
        if (buffer) {
          return buffer
        }
      }
      log.warn('[PluginScreen] 原生截图不可用或无法定位目标显示器，回退到 desktopCapturer')
    }

    // ===== 策略 2: desktopCapturer fallback =====
    return this.captureScreenFallback(options)
  }

  /**
   * 从 sourceId 解析目标 Electron 显示器
   *
   * - 未指定 sourceId → 主显示器
   * - "screen:<id>:x" → 先按内嵌 id 匹配（macOS 上与 display.id 同为
   *   CGDirectDisplayID，可直接命中；Windows 上两者不同源，通常不命中），
   *   多屏时再用 desktopCapturer 的 display_id 做权威映射
   * - 纯数字 → 兼容直接传显示器 id 的历史用法
   *
   * @returns 无法可靠解析时返回 null（调用方应走 fallback）
   */
  private async resolveTargetDisplay(sourceId?: string): Promise<Electron.Display | null> {
    if (!sourceId) return this.screenApi.getPrimaryDisplay()

    const displays = this.screenApi.getAllDisplays()

    if (/^\d+$/.test(sourceId)) {
      return displays.find(display => String(display.id) === sourceId) ?? null
    }

    const parts = sourceId.split(':')
    if (parts[0] !== 'screen' || parts.length < 2) return null

    const embeddedId = Number.parseInt(parts[1], 10)
    if (Number.isFinite(embeddedId)) {
      const matched = displays.find(display => display.id === embeddedId)
      if (matched) return matched
    }

    if (displays.length === 1) return displays[0]

    // Electron 文档认可的对应关系：source.display_id === String(display.id)
    try {
      const sources = await withScreenPermissionErrorMapping(() => this.desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 }
      }))
      const source = sources.find(item => item.id === sourceId)
      if (source?.display_id) {
        const matched = displays.find(display => String(display.id) === source.display_id)
        if (matched) return matched
      }
    } catch (err) {
      log.warn('[PluginScreen] 通过 display_id 解析显示器失败:', err)
    }
    return null
  }

  /**
   * desktopCapturer 回退方案（保留完整兼容性）
   */
  private async captureScreenFallback(options: ScreenshotOptions = {}): Promise<Buffer> {
    const format = options.format || 'png'
    const quality = options.quality || 90

    let sourceId = options.sourceId
    if (!sourceId) {
      const sources = await withScreenPermissionErrorMapping(() => this.desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 }
      }))
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

    const sources = await withScreenPermissionErrorMapping(() => this.desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: {
        width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
        height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
      }
    }))
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
    if (this.nativeCapture.isAvailable()) {
      const buffer = this.nativeCapture.captureRegion(
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
      log.warn('[PluginScreen] 原生区域截图返回空，回退到 desktopCapturer')
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
    const display = this.screenApi.getDisplayMatching(normalizedRegion)

    const sources = await withScreenPermissionErrorMapping(() => this.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
        height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
      }
    }))

    // display_id 是权威映射，但 Linux 上恒为空、Windows 部分版本为空；
    // 此时按显示器枚举下标对齐（screen 源顺序通常与系统枚举一致），避免多屏下盲取第一个截错屏
    const displayOrdinal = this.screenApi.getAllDisplays().findIndex((item) => item.id === display.id)
    const source = sources.find((s) => s.display_id === String(display.id))
      ?? (displayOrdinal >= 0 ? sources[displayOrdinal] : undefined)
      ?? sources[0]
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
    const audioRequested = options.audio === true
    const audioEnabled = audioRequested && isDesktopAudioCaptureSupported()
    if (audioRequested && !audioEnabled) {
      log.warn('[PluginScreen] 当前平台不支持系统音频回环采集，已忽略 audio 选项')
    }

    return {
      audio: audioEnabled ? {
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

/**
 * 当前平台是否支持桌面系统音频回环采集。
 * Chromium 不支持 macOS 的系统音频回环，带 audio 的 desktop 约束会让
 * 整个 getUserMedia 调用失败，因此 macOS 上必须忽略 audio。
 */
export function isDesktopAudioCaptureSupported(): boolean {
  return process.platform !== 'darwin'
}

/**
 * 判断 sourceId 是否指向屏幕（可走原生整屏截图路径）。
 * 窗口源（window:...）等其它源必须走 desktopCapturer。
 */
function isScreenLikeSourceId(sourceId?: string): boolean {
  if (!sourceId) return true
  if (sourceId.startsWith('screen:')) return true
  // 兼容直接传显示器 id 的历史用法
  return /^\d+$/.test(sourceId)
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

async function withScreenPermissionErrorMapping<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isScreenPermissionDeniedError(error)) {
      throw createSystemPermissionDeniedError('screen')
    }
    throw error
  }
}

function isScreenPermissionDeniedError(error: unknown): boolean {
  if (process.platform !== 'darwin') return false

  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  const text = `${name} ${message}`.toLowerCase()
  return text.includes('notallowed') ||
    text.includes('not allowed') ||
    text.includes('permission denied') ||
    text.includes('access denied')
}

// 单例
export const pluginScreen = new PluginScreen()
