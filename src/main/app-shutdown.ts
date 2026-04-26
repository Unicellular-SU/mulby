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
  inputHookService?: { destroy(): void }
  pluginWindowManager?: { closeAll(): void }
  systemPageWindowManager?: { closeAll(): void }
  actionMenuWindowManager?: { destroy(): void }
  appTrayManager?: { destroy(): void }
  trayMenuWindowManager?: { destroy(): void }
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
    await safely('superPanelManager', () => resources.superPanelManager?.destroy())
    await safely('nativeKeySim', () => cleanupNativeKeySim())
    await safely('inputHookService', () => resources.inputHookService?.destroy())
    await safely('pluginWindowManager', () => resources.pluginWindowManager?.closeAll())
    await safely('systemPageWindowManager', () => resources.systemPageWindowManager?.closeAll())
    await safely('actionMenuWindowManager', () => resources.actionMenuWindowManager?.destroy())
    await safely('appTrayManager', () => resources.appTrayManager?.destroy())
    await safely('trayMenuWindowManager', () => resources.trayMenuWindowManager?.destroy())
    await safely('globalShortcut', () => globalShortcut.unregisterAll())
  })().finally(() => {
    hasShutdownCompleted = true
  })

  return shutdownPromise
}
