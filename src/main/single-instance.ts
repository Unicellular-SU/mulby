export type SecondInstanceListener = (
  event: Electron.Event,
  argv: string[],
  workingDirectory: string,
  additionalData: unknown
) => void

export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  quit(): void
  onSecondInstance(listener: SecondInstanceListener): void
}

export function claimPrimaryInstanceLock(
  app: SingleInstanceApp,
  handleSecondInstance: SecondInstanceListener,
  markQuitting: () => void
): boolean {
  if (!app.requestSingleInstanceLock()) {
    markQuitting()
    app.quit()
    return false
  }

  app.onSecondInstance(handleSecondInstance)
  return true
}
