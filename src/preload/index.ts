import { contextBridge, ipcRenderer } from 'electron'
import { inbrowser } from './inbrowser'
import { patchConsoleWithTimestamp } from '../shared/utils/console'
import { createAiApi } from './apis/ai'
import { createSharpApi } from './apis/sharp'
import { createFfmpegApi } from './apis/ffmpeg'
import { createCoreApi } from './apis/core-api'
import { createAppPluginApi } from './apis/app-plugin-api'
import { createPlatformApi } from './apis/platform-api'
import { createLogApi } from './apis/log-api'
import { createMulbyMainApi } from './mulby-main-api'
import { installPreloadErrorCapture } from './error-capture'

// 检测是否启用了 contextIsolation
// 当 contextIsolation 为 false 时，contextBridge 不可用，需要直接设置 window
const isContextIsolated = process.contextIsolated

patchConsoleWithTimestamp()

// 定义 mulby API 对象
const mulbyApi = {
  ...createCoreApi(ipcRenderer),
  ai: createAiApi(ipcRenderer),
  ...createAppPluginApi(ipcRenderer),
  ...createPlatformApi(ipcRenderer),
  inbrowser,
  sharp: createSharpApi(ipcRenderer),
  getSharpVersion: () => ipcRenderer.invoke('sharp:version'),
  ffmpeg: createFfmpegApi(ipcRenderer),
  log: createLogApi(ipcRenderer)
}

// 主窗口专用 API（用于 SubInput 等功能）
const mulbyMainApi = createMulbyMainApi(ipcRenderer)

// 根据 contextIsolation 状态选择暴露方式
if (isContextIsolated) {
  // contextIsolation 启用时，使用 contextBridge（安全模式）
  contextBridge.exposeInMainWorld('mulby', mulbyApi)
  contextBridge.exposeInMainWorld('mulbyMain', mulbyMainApi)
} else {
  // contextIsolation 禁用时，直接设置 window 属性（自定义 preload 模式）
  // @ts-ignore - 在非隔离模式下直接访问 window
  window.mulby = mulbyApi
  // @ts-ignore
  window.mulbyMain = mulbyMainApi
}

// ==================== 自动错误捕获（开发者模式） ====================
installPreloadErrorCapture(ipcRenderer)
