/**
 * native-screen-capture.ts — 原生截图模块 TS 封装
 *
 * 封装 C++ N-API 原生模块，提供类型安全的截图和取色接口。
 * 自动处理：
 *   - 原生模块加载（开发/生产环境路径差异）
 *   - 加载失败时的优雅降级（返回 null）
 *   - raw BGRA bitmap → nativeImage → Buffer 转换
 */

import { join } from 'path'
import { app, nativeImage, screen } from 'electron'
import log from 'electron-log'
import { nativePhysicalRegionToDip, type RegionBounds } from './screen-coordinate-utils'

// 原生模块导出的 API 类型
interface NativeScreenCaptureAddon {
  captureScreen(displayIndex?: number): { buffer: Buffer; width: number; height: number }
  captureRegion(x: number, y: number, width: number, height: number): { buffer: Buffer; width: number; height: number }
  getPixelColor(x: number, y: number): { r: number; g: number; b: number }
  getDisplays(): Array<{ id: number; x: number; y: number; width: number; height: number; scaleFactor: number }>
  // macOS 独有：NSColorSampler 异步取色
  pickColor?(callback: (color: { r: number; g: number; b: number } | null) => void): void
  // Windows 独有：原生区域截图
  startRegionCapture?(callback: (result: {
    success: boolean
    x?: number; y?: number; width?: number; height?: number
    buffer?: Buffer; imageWidth?: number; imageHeight?: number
  }) => void): void
  // Windows 独有：原生实时取色器
  startColorPick?(callback: (result: {
    success: boolean
    r?: number; g?: number; b?: number
  }) => void): void
}

type NativeColorPickOutcome =
  | { type: 'color'; r: number; g: number; b: number }
  | { type: 'cancelled' }
  | { type: 'unavailable' }

// 缓存加载的原生模块实例
let cachedAddon: NativeScreenCaptureAddon | null | undefined = undefined

/**
 * 加载原生截图模块
 * 返回 null 表示加载失败（应使用 fallback 方案）
 */
function loadAddon(): NativeScreenCaptureAddon | null {
  if (cachedAddon !== undefined) return cachedAddon

  try {
    let addonPath: string
    if (app.isPackaged) {
      addonPath = join(process.resourcesPath, 'native', 'build', 'Release', 'screen_capture.node')
    } else {
      addonPath = join(app.getAppPath(), 'native', 'build', 'Release', 'screen_capture.node')
    }

    cachedAddon = require(addonPath) as NativeScreenCaptureAddon
    log.info('[NativeScreenCapture] 原生模块加载成功')
    return cachedAddon
  } catch (err) {
    log.warn('[NativeScreenCapture] 原生模块加载失败，将使用 fallback:', err)
    cachedAddon = null
    return null
  }
}

/**
 * 检查原生截图模块是否可用
 */
export function isNativeScreenCaptureAvailable(): boolean {
  return loadAddon() !== null
}

/**
 * 将 raw BGRA bitmap 转换为 PNG Buffer
 * 使用 Electron nativeImage.createFromBitmap() 实现高效转换
 */
function bitmapToPNG(bitmapData: { buffer: Buffer; width: number; height: number }): Buffer {
  const image = nativeImage.createFromBitmap(bitmapData.buffer, {
    width: bitmapData.width,
    height: bitmapData.height
  })
  return image.toPNG()
}

/**
 * 将 raw BGRA bitmap 转换为 JPEG Buffer
 */
function bitmapToJPEG(bitmapData: { buffer: Buffer; width: number; height: number }, quality: number): Buffer {
  const image = nativeImage.createFromBitmap(bitmapData.buffer, {
    width: bitmapData.width,
    height: bitmapData.height
  })
  return image.toJPEG(quality)
}

/**
 * 原生全屏截图
 * @param displayIndex 显示器索引（默认 0，主屏幕）
 * @param format 输出格式
 * @param quality JPEG 质量
 * @returns Buffer（PNG/JPEG）或 null（原生模块不可用）
 */
export function nativeCaptureScreen(
  displayIndex?: number,
  format: 'png' | 'jpeg' = 'png',
  quality = 90
): Buffer | null {
  const addon = loadAddon()
  if (!addon) return null

  try {
    const bitmap = addon.captureScreen(displayIndex)
    if (!bitmap || !bitmap.buffer || bitmap.width <= 0 || bitmap.height <= 0) {
      return null
    }
    return format === 'jpeg' ? bitmapToJPEG(bitmap, quality) : bitmapToPNG(bitmap)
  } catch (err) {
    log.error('[NativeScreenCapture] captureScreen 失败:', err)
    return null
  }
}

/**
 * 原生区域截图
 * 坐标为 Electron 逻辑坐标 (DIP)，Windows/Linux 自动转换为设备像素
 * @returns Buffer（PNG/JPEG）或 null（原生模块不可用）
 */
export function nativeCaptureRegion(
  x: number,
  y: number,
  width: number,
  height: number,
  format: 'png' | 'jpeg' = 'png',
  quality = 90
): Buffer | null {
  const addon = loadAddon()
  if (!addon) return null

  try {
    // Windows/Linux: 将逻辑坐标 (DIP) 转换为设备像素坐标
    // macOS 的 CGWindowListCreateImage 自动处理 Retina，无需转换
    const { devX, devY, devW, devH } = dipToDevice(x, y, width, height)

    const bitmap = addon.captureRegion(devX, devY, devW, devH)
    if (!bitmap || !bitmap.buffer || bitmap.width <= 0 || bitmap.height <= 0) {
      return null
    }
    return format === 'jpeg' ? bitmapToJPEG(bitmap, quality) : bitmapToPNG(bitmap)
  } catch (err) {
    log.error('[NativeScreenCapture] captureRegion 失败:', err)
    return null
  }
}

/**
 * 原生全屏截图（返回 raw bitmap，供取色器高频使用）
 * 不做 PNG 编码，直接返回 BGRA bitmap + 尺寸信息
 */
export function nativeCaptureScreenRaw(
  displayIndex?: number
): { buffer: Buffer; width: number; height: number } | null {
  const addon = loadAddon()
  if (!addon) return null

  try {
    const bitmap = addon.captureScreen(displayIndex)
    if (!bitmap || !bitmap.buffer || bitmap.width <= 0 || bitmap.height <= 0) {
      return null
    }
    return bitmap
  } catch (err) {
    log.error('[NativeScreenCapture] captureScreenRaw 失败:', err)
    return null
  }
}

/**
 * 原生取色（指定坐标的单个像素）
 * 坐标为 Electron 逻辑坐标 (DIP)，Windows/Linux 自动转换为设备像素
 */
export function nativeGetPixelColor(
  x: number,
  y: number
): { r: number; g: number; b: number } | null {
  const addon = loadAddon()
  if (!addon) return null

  try {
    const { devX, devY } = dipToDevice(x, y, 1, 1)
    return addon.getPixelColor(devX, devY)
  } catch (err) {
    log.error('[NativeScreenCapture] getPixelColor 失败:', err)
    return null
  }
}

/**
 * macOS 原生取色器（NSColorSampler）
 * 调用系统原生取色面板，带放大镜和精准取色功能
 * @returns Promise<{r, g, b} | null>，null 表示用户取消或不支持
 */
export function nativePickColor(): Promise<{ r: number; g: number; b: number } | null> {
  const addon = loadAddon()

  if (!addon || typeof addon.pickColor !== 'function') {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    try {
      addon.pickColor!((color) => {
        resolve(color)
      })
    } catch (err) {
      log.error('[NativeScreenCapture] pickColor 失败:', err)
      resolve(null)
    }
  })
}

/**
 * Windows 原生实时取色器
 *
 * 使用 Win32 低级鼠标/键盘 hook + GetPixel 实时读取当前屏幕像素。
 * 不预截全屏、不创建 Electron 覆盖窗口，因此不会把任务栏或覆盖层截入背景。
 */
export function nativeStartColorPick(): Promise<NativeColorPickOutcome> {
  const addon = loadAddon()

  if (!addon || typeof addon.startColorPick !== 'function') {
    return Promise.resolve({ type: 'unavailable' })
  }

  return new Promise((resolve) => {
    try {
      addon.startColorPick!((result) => {
        if (
          result.success &&
          typeof result.r === 'number' &&
          typeof result.g === 'number' &&
          typeof result.b === 'number'
        ) {
          resolve({ type: 'color', r: result.r, g: result.g, b: result.b })
          return
        }

        resolve({ type: 'cancelled' })
      })
    } catch (err) {
      log.error('[NativeScreenCapture] startColorPick 调用失败:', err)
      resolve({ type: 'unavailable' })
    }
  })
}

/**
 * 从预截取的 raw BGRA bitmap 中提取指定区域的像素
 * 用于取色器的高频预览（零 IPC，纯内存操作）
 *
 * @param snapshot 预截取的全屏 bitmap
 * @param cx 中心点 X（相对于 bitmap 坐标）
 * @param cy 中心点 Y（相对于 bitmap 坐标）
 * @param size 采样区域边长（如 11 = 11x11 像素）
 * @returns 裁剪后的 PNG Buffer 或 null
 */
export function extractRegionFromSnapshot(
  snapshot: { buffer: Buffer; width: number; height: number },
  cx: number,
  cy: number,
  size: number
): string | null {
  const half = Math.floor(size / 2)
  const { buffer, width, height } = snapshot

  // 计算裁剪区域（处理边界）
  const startX = Math.max(0, Math.min(width - 1, Math.round(cx) - half))
  const startY = Math.max(0, Math.min(height - 1, Math.round(cy) - half))
  const endX = Math.min(width, startX + size)
  const endY = Math.min(height, startY + size)
  const cropW = endX - startX
  const cropH = endY - startY

  if (cropW <= 0 || cropH <= 0) return null

  // 从 BGRA bitmap 中裁剪出子区域
  const cropBuffer = Buffer.alloc(cropW * cropH * 4)
  for (let y = 0; y < cropH; y++) {
    const srcOffset = ((startY + y) * width + startX) * 4
    const dstOffset = y * cropW * 4
    buffer.copy(cropBuffer, dstOffset, srcOffset, srcOffset + cropW * 4)
  }

  // 转换为 PNG 并返回 data URL
  const image = nativeImage.createFromBitmap(cropBuffer, {
    width: cropW,
    height: cropH
  })

  return `data:image/png;base64,${image.toPNG().toString('base64')}`
}

// ============================================================
// HiDPI 坐标转换工具
// ============================================================

/**
 * 将 Electron 逻辑坐标 (DIP) 转换为设备像素坐标
 *
 * - macOS: CGWindowListCreateImage 接受逻辑坐标并自动返回 Retina 分辨率，无需转换
 * - Windows: GDI BitBlt/GetPixel 使用设备像素坐标，需要乘以 scaleFactor
 * - Linux: X11 XGetImage 使用物理像素坐标，需要乘以 scaleFactor
 */
function dipToDevice(
  x: number,
  y: number,
  width: number,
  height: number
): { devX: number; devY: number; devW: number; devH: number } {
  if (process.platform === 'darwin') {
    // macOS 不需要坐标转换
    return { devX: x, devY: y, devW: width, devH: height }
  }

  // Windows/Linux: 查找目标显示器并获取缩放因子
  const display = screen.getDisplayNearestPoint({ x, y })
  const sf = display.scaleFactor || 1

  if (sf === 1) {
    return { devX: x, devY: y, devW: width, devH: height }
  }

  // 将 DIP 坐标转为设备像素坐标
  // 相对于显示器原点做缩放，保证多显示器场景下偏移正确
  const devX = Math.round(display.bounds.x * sf + (x - display.bounds.x) * sf)
  const devY = Math.round(display.bounds.y * sf + (y - display.bounds.y) * sf)
  const devW = Math.round(width * sf)
  const devH = Math.round(height * sf)

  return { devX, devY, devW, devH }
}

/**
 * Windows 原生区域截图
 * 使用 C++ 原生窗口（WS_EX_TOPMOST）覆盖全屏，用户拖拽选区后返回裁剪结果。
 * 不污染剪贴板，不依赖 Electron BrowserWindow。
 * @returns { dataUrl, bounds } 或 null（用户取消/不可用）
 */
export function nativeStartRegionCapture(): Promise<{
  dataUrl: string
  bounds: { x: number; y: number; width: number; height: number }
} | null> {
  const addon = loadAddon()
  if (!addon || typeof addon.startRegionCapture !== 'function') {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    try {
      addon.startRegionCapture!((result) => {
        if (!result.success || !result.buffer || !result.imageWidth || !result.imageHeight) {
          resolve(null)
          return
        }
        try {
          const image = nativeImage.createFromBitmap(result.buffer, {
            width: result.imageWidth,
            height: result.imageHeight
          })
          const pngBuffer = image.toPNG()
          const rawBounds: RegionBounds = {
            x: result.x || 0,
            y: result.y || 0,
            width: result.width || result.imageWidth,
            height: result.height || result.imageHeight
          }
          const nativeDisplays = typeof addon.getDisplays === 'function' ? addon.getDisplays() : []
          const electronDisplays = screen.getAllDisplays().map(display => ({
            id: display.id,
            bounds: display.bounds,
            scaleFactor: display.scaleFactor
          }))
          const bounds = process.platform === 'win32'
            ? nativePhysicalRegionToDip(rawBounds, nativeDisplays, electronDisplays)
            : rawBounds
          const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
          resolve({
            dataUrl,
            bounds
          })
        } catch (err) {
          log.error('[NativeScreenCapture] startRegionCapture 转换失败:', err)
          resolve(null)
        }
      })
    } catch (err) {
      log.error('[NativeScreenCapture] startRegionCapture 调用失败:', err)
      resolve(null)
    }
  })
}
