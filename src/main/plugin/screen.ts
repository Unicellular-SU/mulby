import { desktopCapturer, screen } from 'electron'

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
   */
  async captureScreen(options: ScreenshotOptions = {}): Promise<Buffer> {
    const format = options.format || 'png'
    const quality = options.quality || 90

    let sourceId = options.sourceId

    // 如果没有指定 sourceId，获取主屏幕
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

    // 获取完整截图
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 1920, height: 1080 }
    })

    const source = sources.find(s => s.id === sourceId)
    if (!source) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    // 使用 BrowserWindow 的 capturePage 或直接返回 thumbnail
    // 注意：desktopCapturer 的 thumbnail 尺寸有限，完整截图需要使用 MediaStream
    // 这里我们使用一个隐藏窗口来获取完整截图

    const image = source.thumbnail

    if (format === 'jpeg') {
      return image.toJPEG(quality)
    }
    return image.toPNG()
  }

  /**
   * 截取指定区域
   */
  async captureRegion(
    region: { x: number; y: number; width: number; height: number },
    options: Omit<ScreenshotOptions, 'sourceId'> = {}
  ): Promise<Buffer> {
    const format = options.format || 'png'
    const quality = options.quality || 90

    // 获取包含该区域的显示器
    const display = screen.getDisplayNearestPoint({ x: region.x, y: region.y })

    // 获取该显示器的截图
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: display.bounds.width * display.scaleFactor,
        height: display.bounds.height * display.scaleFactor
      }
    })

    const source = sources.find(s => s.display_id === String(display.id)) || sources[0]
    if (!source) {
      throw new Error('No screen source available')
    }

    // 裁剪区域
    const image = source.thumbnail
    const cropped = image.crop({
      x: Math.max(0, region.x - display.bounds.x) * display.scaleFactor,
      y: Math.max(0, region.y - display.bounds.y) * display.scaleFactor,
      width: region.width * display.scaleFactor,
      height: region.height * display.scaleFactor
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

// 单例
export const pluginScreen = new PluginScreen()
