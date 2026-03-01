import type { IpcRenderer } from 'electron'

export function installPreloadErrorCapture(ipcRenderer: IpcRenderer) {
  const originalConsoleError = console.error
  const originalConsoleWarn = console.warn

  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args)
    try {
      const message = args.map(arg => {
        if (arg instanceof Error) {
          return `${arg.message}\n${arg.stack || ''}`
        }
        return typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      }).join(' ')
      ipcRenderer.send('log:write', 'error', message)
    } catch {
      // ignore serialization errors
    }
  }

  console.warn = (...args: unknown[]) => {
    originalConsoleWarn.apply(console, args)
    try {
      const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ')
      ipcRenderer.send('log:write', 'warn', message)
    } catch {
      // ignore serialization errors
    }
  }

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
