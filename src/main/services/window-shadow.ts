import type { BrowserWindow } from 'electron'

export function refreshNativeShadow(win: BrowserWindow | null): void {
  if (process.platform !== 'darwin' || !win || win.isDestroyed()) return

  try {
    win.invalidateShadow()
  } catch {
    // Shadow invalidation is a macOS-only repaint hint; ignore unsupported states.
  }
}
