import { ipcMain } from 'electron'
import {
  pluginScreen,
  isDesktopAudioCaptureSupported,
  CaptureOptions,
  ScreenshotOptions,
  RecordingOptions
} from '../plugin/screen'
import { permissionManager } from '../plugin/permission-manager'

function assertScreenPermission(sender: Electron.WebContents): void {
  permissionManager.ensureCallerAccessMediaPermissions(sender, ['screen'])
}

function assertRecordingPermissions(sender: Electron.WebContents): void {
  permissionManager.ensureCallerAccessMediaPermissions(sender, ['screen'])
}

function assertCursorPointPermission(sender: Electron.WebContents): void {
  // 光标位置属于输入监控信息，可被轮询用于追踪；
  // 已声明 screen（可整屏截图）的插件没有额外隐私增量，直接放行
  if (permissionManager.canCallerAccessPluginPermissions(sender, ['screen'])) return
  permissionManager.ensureCallerAccessPluginPermissions(sender, ['inputMonitor'])
}

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
  ipcMain.handle('screen:getCursorScreenPoint', (event) => {
    assertCursorPointPermission(event.sender)
    return pluginScreen.getCursorScreenPoint()
  })

  // 获取矩形区域所在的显示器
  ipcMain.handle('screen:getDisplayMatching', (_, rect: { x: number; y: number; width: number; height: number }) => {
    return pluginScreen.getDisplayMatching(rect)
  })

  // 获取可捕获的源
  ipcMain.handle('screen:getSources', async (event, options?: CaptureOptions) => {
    assertScreenPermission(event.sender)
    return pluginScreen.getSources(options)
  })

  // 获取窗口捕获源的当前边界
  ipcMain.handle('screen:getWindowBounds', async (event, sourceId: string) => {
    assertScreenPermission(event.sender)
    return pluginScreen.getWindowBounds(sourceId)
  })

  // 截取屏幕
  ipcMain.handle('screen:capture', async (event, options?: ScreenshotOptions) => {
    assertScreenPermission(event.sender)
    return pluginScreen.captureScreen(options)
  })

  // 截取指定区域
  ipcMain.handle('screen:captureRegion', async (
    event,
    region: { x: number; y: number; width: number; height: number },
    options?: Omit<ScreenshotOptions, 'sourceId'>
  ) => {
    assertScreenPermission(event.sender)
    return pluginScreen.captureRegion(region, options)
  })

  // 获取录屏 MediaStream 约束
  ipcMain.handle('screen:getMediaStreamConstraints', (event, options: RecordingOptions) => {
    assertRecordingPermissions(event.sender)
    permissionManager.markPendingDesktopCapture(event.sender, {
      audio: options.audio === true && isDesktopAudioCaptureSupported()
    })
    return pluginScreen.getMediaStreamConstraints(options)
  })

  // DIP/物理坐标转换
  ipcMain.handle('screen:screenToDipPoint', (_, point: { x: number; y: number }) => {
    return pluginScreen.screenToDipPoint(point)
  })

  ipcMain.handle('screen:dipToScreenPoint', (_, point: { x: number; y: number }) => {
    return pluginScreen.dipToScreenPoint(point)
  })

  ipcMain.handle('screen:screenToDipRect', (_, rect: { x: number; y: number; width: number; height: number }) => {
    return pluginScreen.screenToDipRect(rect)
  })

  ipcMain.handle('screen:dipToScreenRect', (_, rect: { x: number; y: number; width: number; height: number }) => {
    return pluginScreen.dipToScreenRect(rect)
  })
}
