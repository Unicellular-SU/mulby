export interface MainWindowClosePolicyInput {
  closeToTray: boolean
  isQuitting: boolean
}

export function shouldPreventMainWindowClose(input: MainWindowClosePolicyInput): boolean {
  return input.closeToTray && !input.isQuitting
}
