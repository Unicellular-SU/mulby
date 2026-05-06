export interface MainWindowTogglePolicyInput {
  isWindowVisible: boolean
  isMainSurfaceFocused: boolean
}

export function shouldHideMainWindowOnToggle(input: MainWindowTogglePolicyInput): boolean {
  return input.isWindowVisible && input.isMainSurfaceFocused
}
