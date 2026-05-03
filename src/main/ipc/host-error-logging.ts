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
