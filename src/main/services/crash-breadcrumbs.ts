import { app, crashReporter } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

const MAX_BREADCRUMB_LOG_BYTES = 1024 * 1024
const MAX_CRASH_EXTRA_VALUE_LENGTH = 4096
const MAX_STRING_LENGTH = 1200
const MAX_ARRAY_ITEMS = 30
const MAX_OBJECT_KEYS = 40
const TRACE_SYSTEM_ICONS_ENV = 'MULBY_TRACE_SYSTEM_ICONS'
const TRACE_PLUGIN_ID = '@mulby/showcase'

let sequence = 0
let installed = false

function getBreadcrumbPaths() {
  const logsDir = join(app.getPath('userData'), 'logs')
  return {
    logsDir,
    logPath: join(logsDir, 'crash-breadcrumbs.log'),
    previousLogPath: join(logsDir, 'crash-breadcrumbs.previous.log'),
    lastPath: join(logsDir, 'crash-breadcrumbs-last.json')
  }
}

export function getCrashBreadcrumbLogPath(): string {
  return getBreadcrumbPaths().logPath
}

function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...<truncated:${value.length - maxLength}>`
}

function sanitizeForBreadcrumb(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return truncateString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol') return String(value)
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: value.stack ? truncateString(value.stack, 3000) : undefined
    }
  }

  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  if (depth >= 4) return '[MaxDepth]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeForBreadcrumb(item, depth + 1, seen))
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).slice(0, MAX_OBJECT_KEYS)) {
    try {
      result[key] = sanitizeForBreadcrumb((value as Record<string, unknown>)[key], depth + 1, seen)
    } catch (error) {
      result[key] = `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`
    }
  }
  return result
}

function rotateBreadcrumbLogIfNeeded(logPath: string, previousLogPath: string): void {
  try {
    const stat = statSync(logPath)
    if (stat.size < MAX_BREADCRUMB_LOG_BYTES) return
    renameSync(logPath, previousLogPath)
  } catch {
    // Missing or inaccessible breadcrumb logs should never affect app behavior.
  }
}

function isTracePluginBreadcrumb(data: Record<string, unknown> | undefined): boolean {
  return data?.pluginId === TRACE_PLUGIN_ID
}

function shouldRecordBreadcrumb(event: string, data?: Record<string, unknown>): boolean {
  if (process.env[TRACE_SYSTEM_ICONS_ENV] === '1') {
    return true
  }

  if (event.startsWith('system.icon') && !event.includes(':error')) {
    return isTracePluginBreadcrumb(data)
  }

  if (event.startsWith('system.ipc')) {
    return isTracePluginBreadcrumb(data)
  }

  if (event === 'plugin:console') {
    return isTracePluginBreadcrumb(data)
  }

  return true
}

export function recordCrashBreadcrumb(event: string, data?: Record<string, unknown>): void {
  if (!shouldRecordBreadcrumb(event, data)) {
    return
  }

  const paths = getBreadcrumbPaths()
  const entry = {
    timestamp: new Date().toISOString(),
    uptimeMs: Math.round(process.uptime() * 1000),
    pid: process.pid,
    seq: ++sequence,
    event,
    data: sanitizeForBreadcrumb(data)
  }
  const line = `${JSON.stringify(entry)}\n`

  try {
    mkdirSync(paths.logsDir, { recursive: true })
    rotateBreadcrumbLogIfNeeded(paths.logPath, paths.previousLogPath)
    appendFileSync(paths.logPath, line, 'utf-8')
    writeFileSync(paths.lastPath, line, 'utf-8')
  } catch {
    // Breadcrumbs are diagnostic-only; failure to write must not crash Mulby.
  }

  try {
    crashReporter.addExtraParameter('mulby_last_breadcrumb', truncateString(line, MAX_CRASH_EXTRA_VALUE_LENGTH))
  } catch {
    // CrashReporter may not be started in unit tests or very early startup.
  }
}

export function installCrashBreadcrumbHandlers(): void {
  if (installed) return
  installed = true

  recordCrashBreadcrumb('main:breadcrumb-handlers-installed', {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    breadcrumbs: getCrashBreadcrumbLogPath()
  })

  process.on('uncaughtExceptionMonitor', (error) => {
    recordCrashBreadcrumb('process:uncaughtExceptionMonitor', { error })
  })

  process.on('unhandledRejection', (reason) => {
    recordCrashBreadcrumb('process:unhandledRejection', { reason })
  })

  process.on('warning', (warning) => {
    recordCrashBreadcrumb('process:warning', { warning })
  })

  app.on('before-quit', () => {
    recordCrashBreadcrumb('app:before-quit')
  })

  app.on('will-quit', () => {
    recordCrashBreadcrumb('app:will-quit')
  })

  app.on('render-process-gone', (_event, webContents, details) => {
    recordCrashBreadcrumb('app:render-process-gone', {
      webContentsId: webContents.id,
      type: webContents.getType(),
      url: webContents.getURL(),
      reason: details.reason,
      exitCode: details.exitCode
    })
  })

  app.on('child-process-gone', (_event, details) => {
    recordCrashBreadcrumb('app:child-process-gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name
    })
  })

  app.on('web-contents-created', (_event, webContents) => {
    recordCrashBreadcrumb('webContents:created', {
      webContentsId: webContents.id,
      type: webContents.getType()
    })

    webContents.on('did-fail-load', (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
      recordCrashBreadcrumb('webContents:did-fail-load', {
        webContentsId: webContents.id,
        type: webContents.getType(),
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      })
    })

    webContents.once('destroyed', () => {
      recordCrashBreadcrumb('webContents:destroyed', {
        webContentsId: webContents.id
      })
    })
  })
}
