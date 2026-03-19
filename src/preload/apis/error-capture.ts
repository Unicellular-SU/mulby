import type { IpcRenderer } from 'electron'

/**
 * 安装 preload 层错误捕获
 *
 * 职责：仅捕获 uncaught error 和 unhandled rejection，通过 IPC 发送到日志系统。
 * console.log/info/warn/error 的捕获由主进程侧的 console-message 事件统一处理
 * （见 console-capture.ts），不在此处覆写，避免与 patchConsoleWithTimestamp 冲突导致重复日志。
 */
export function installPreloadErrorCapture(ipcRenderer: IpcRenderer) {
  window.addEventListener('error', (event) => {
    try {
      const message = event.error
        ? `${event.error.message}\n${event.error.stack || ''}`
        : `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
      ipcRenderer.send('log:write', 'error', `[Uncaught Error] ${message}`)
    } catch {
      ipcRenderer.send('log:write', 'error', '[Uncaught Error] (failed to serialize)')
    }
  })

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason
      const message = reason instanceof Error
        ? `${reason.message}\n${reason.stack || ''}`
        : typeof reason === 'object' ? JSON.stringify(reason) : String(reason)
      ipcRenderer.send('log:write', 'error', `[Unhandled Rejection] ${message}`)
    } catch {
      ipcRenderer.send('log:write', 'error', '[Unhandled Rejection] (failed to serialize)')
    }
  })
}
