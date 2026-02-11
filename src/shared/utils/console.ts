const PATCHED_FLAG = '__mulby_console_ts_patched__'

function formatTimestamp() {
  const d = new Date()
  const pad = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export function patchConsoleWithTimestamp(target: Console = console) {
  const t = target as Console & { [PATCHED_FLAG]?: boolean }
  if (t[PATCHED_FLAG]) return
  t[PATCHED_FLAG] = true

  ;(['log', 'info', 'warn', 'error', 'debug'] as const).forEach((method) => {
    const original = target[method]?.bind(target)
    if (!original) return
    target[method] = (...args: unknown[]) => {
      original(`[${formatTimestamp()}]`, ...args)
    }
  })
}
