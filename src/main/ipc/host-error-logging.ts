export type HostIpcChannel = 'host:invoke' | 'host:call'

export interface HostErrorLogger {
  write(level: 'error', pluginId: string, message: string): void
}

export function formatHostIpcError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function buildHostIpcErrorMessage(
  channel: HostIpcChannel,
  method: string,
  error: unknown
): string {
  return `Error occurred in handler for '${channel}' (${method}): ${formatHostIpcError(error)}`
}

export function logHostIpcError(
  logger: HostErrorLogger,
  channel: HostIpcChannel,
  pluginName: string,
  method: string,
  error: unknown
): void {
  logger.write(
    'error',
    pluginName || 'unknown',
    buildHostIpcErrorMessage(channel, method, error)
  )
}

/**
 * 把 host IPC 错误回灌到发起调用的插件 webContents 控制台，
 * 让开发者在插件 DevTools 里能直接看到后端调用失败的原因，
 * 而不必去翻主进程日志。仅在错误路径触发，对正常调用零开销。
 *
 * 使用 JSON.stringify 安全转义注入文本，避免脚本注入。
 */
export function forwardHostIpcErrorToConsole(
  sender: Pick<Electron.WebContents, 'isDestroyed' | 'executeJavaScript'> | null | undefined,
  channel: HostIpcChannel,
  method: string,
  error: unknown
): void {
  if (!sender || sender.isDestroyed()) return
  const message = `[Mulby] ${buildHostIpcErrorMessage(channel, method, error)}`
  try {
    void sender.executeJavaScript(`console.error(${JSON.stringify(message)})`).catch(() => {})
  } catch {
    // executeJavaScript 在 webContents 已销毁/导航时可能抛同步异常，忽略即可
  }
}
