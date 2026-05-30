export interface MainWindowTogglePolicyInput {
  isWindowVisible: boolean
  isMainSurfaceFocused: boolean
  isAppFocused?: boolean
  windowOpacity?: number
}

export function shouldHideMainWindowOnToggle(input: MainWindowTogglePolicyInput): boolean {
  return input.isWindowVisible
    && input.isMainSurfaceFocused
    && input.isAppFocused !== false
    && (input.windowOpacity === undefined || input.windowOpacity > 0)
}
