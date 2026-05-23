export interface PreCaptureWindowRestoreInput {
  mainHide: boolean
  mainWindowWasVisibleBeforeCapture: boolean
}

export function shouldRestoreMainWindowAfterPreCapture(input: PreCaptureWindowRestoreInput): boolean {
  return !input.mainHide && input.mainWindowWasVisibleBeforeCapture
}