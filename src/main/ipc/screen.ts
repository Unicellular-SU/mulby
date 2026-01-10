import { ipcMain } from 'electron'
import { pluginScreen, CaptureOptions, ScreenshotOptions, RecordingOptions } from '../plugin/screen'

export function registerScreenHandlers() {
  // 获取所有显示器
  ipcMain.handle('screen:getAllDisplays', () => {
    return pluginScreen.getAllDisplays()
  })

  // 获取主显示器
  ipcMain.handle('screen:getPrimaryDisplay', () => {
    return pluginScreen.getPrimaryDisplay()
  })

  // 获取指定位置的显示器
  ipcMain.handle('screen:getDisplayNearestPoint', (_, point: { x: number; y: number }) => {
    return pluginScreen.getDisplayNearestPoint(point)
  })

  // 获取鼠标位置
  ipcMain.handle('screen:getCursorScreenPoint', () => {
    return pluginScreen.getCursorScreenPoint()
  })

  // 获取可捕获的源
  ipcMain.handle('screen:getSources', async (_, options?: CaptureOptions) => {
    return pluginScreen.getSources(options)
  })

  // 截取屏幕
  ipcMain.handle('screen:capture', async (_, options?: ScreenshotOptions) => {
    return pluginScreen.captureScreen(options)
  })

  // 截取指定区域
  ipcMain.handle('screen:captureRegion', async (
    _,
    region: { x: number; y: number; width: number; height: number },
    options?: Omit<ScreenshotOptions, 'sourceId'>
  ) => {
    return pluginScreen.captureRegion(region, options)
  })

  // 获取录屏 MediaStream 约束
  ipcMain.handle('screen:getMediaStreamConstraints', (_, options: RecordingOptions) => {
    return pluginScreen.getMediaStreamConstraints(options)
  })
}
