interface MainWindowLike {
  isDestroyed: () => boolean
  webContents: {
    send: (channel: string, payload: unknown) => void
  }
}

interface PendingPrepareRequest {
  resolve: () => void
  timer: NodeJS.Timeout
}

export interface SystemPluginBeforeAttachPayload {
  requestId: string
  pluginId: string
}

export class SystemPluginWindowManager {
  private mainWindow: MainWindowLike | null = null
  private activePluginId: string | null = null
  private prepareSequence = 0
  private pendingPrepareRequests = new Map<string, PendingPrepareRequest>()

  setMainWindow(window: MainWindowLike | null): void {
    this.mainWindow = window
    if (!window) {
      this.clearPendingRequests()
      this.activePluginId = null
    }
  }

  setActiveSystemPlugin(pluginId: string | null | undefined): void {
    const normalized = typeof pluginId === 'string' ? pluginId.trim() : ''
    this.activePluginId = normalized || null
  }

  getActiveSystemPlugin(): string | null {
    return this.activePluginId
  }

  async prepareForAttachedPluginLaunch(timeoutMs = 450): Promise<void> {
    const window = this.mainWindow
    const activePluginId = this.activePluginId
    if (!window || window.isDestroyed() || !activePluginId) {
      return
    }

    const requestId = `${Date.now()}-${++this.prepareSequence}`
    const payload: SystemPluginBeforeAttachPayload = {
      requestId,
      pluginId: activePluginId
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPrepareRequests.delete(requestId)
        resolve()
      }, timeoutMs)

      this.pendingPrepareRequests.set(requestId, {
        resolve: () => {
          clearTimeout(timer)
          this.pendingPrepareRequests.delete(requestId)
          resolve()
        },
        timer
      })

      try {
        window.webContents.send('app:systemPluginBeforeAttach', payload)
      } catch {
        clearTimeout(timer)
        this.pendingPrepareRequests.delete(requestId)
        resolve()
      }
    })
  }

  notifyReadyForAttach(requestId: string): boolean {
    const request = this.pendingPrepareRequests.get(requestId)
    if (!request) return false
    request.resolve()
    return true
  }

  private clearPendingRequests(): void {
    for (const pending of this.pendingPrepareRequests.values()) {
      clearTimeout(pending.timer)
      pending.resolve()
    }
    this.pendingPrepareRequests.clear()
  }
}
