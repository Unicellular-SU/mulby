import { globalShortcut } from 'electron'
import log from 'electron-log'
import { cleanupNativeKeySim } from './services/native-keyboard-sim'

/**
 * Resources to be cleaned up on shutdown.
 * Registered lazily during app initialization.
 */
export interface ShutdownResources {
  clipboardHistoryManager?: { stop(): void }
  clipboardWatcher?: { stop(): void }
  pluginManager?: { destroy(): Promise<void> }
  mcpServerManager?: { cleanup(): Promise<void> }
  openclawService?: { destroy(): void }
  superPanelManager?: { destroy(): void }
  floatingBallManager?: { destroy(): void }
  inputHookService?: { destroy(): void }
  pluginWindowManager?: { closeAll(): void }
  systemPageWindowManager?: { closeAll(): void }
  actionMenuWindowManager?: { destroy(): void }
  appTrayManager?: { destroy(): void }
  trayMenuWindowManager?: { destroy(): void }
  activeWindowCleanup?: () => void
}

let hasShutdownCompleted = false
let shutdownPromise: Promise<void> | null = null

export function isShutdownComplete(): boolean {
  return hasShutdownCompleted
}

export async function shutdownMainProcessResources(
  resources: ShutdownResources
): Promise<void> {
  if (hasShutdownCompleted) return
  if (shutdownPromise) return shutdownPromise

  shutdownPromise = (async () => {
    const safely = async (label: string, fn: () => void | Promise<void>) => {
      try { await fn() } catch (error) {
        log.error(`[Shutdown] Failed to cleanup ${label}:`, error)
      }
    }

    await safely('clipboardHistoryManager', () => resources.clipboardHistoryManager?.stop())
    await safely('clipboardWatcher', () => resources.clipboardWatcher?.stop())
    await safely('pluginManager', () => resources.pluginManager?.destroy())
    await safely('mcpServerManager', () => resources.mcpServerManager?.cleanup())
    await safely('openclawService', () => resources.openclawService?.destroy())
    await safely('nativeKeySim', () => cleanupNativeKeySim())
    await safely('inputHookService', () => resources.inputHookService?.destroy())
    await safely('activeWindowWatcher', () => resources.activeWindowCleanup?.())
    await safely('globalShortcut', () => globalShortcut?.unregisterAll?.())

    // BrowserWindow operations (superPanelManager, pluginWindowManager,
    // systemPageWindowManager, actionMenuWindowManager, appTrayManager,
    // trayMenuWindowManager) are intentionally skipped. On macOS,
    // BrowserWindow.close()/destroy() can synchronously block the main thread
    // in native Cocoa code, deadlocking the process. The OS reclaims all
    // window resources when the process exits via app.exit(0).
  })().finally(() => {
    hasShutdownCompleted = true
  })

  return shutdownPromise
}
