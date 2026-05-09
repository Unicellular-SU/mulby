interface SearchPanelResetInput {
  hasInput: boolean
  showSearchPanel: boolean
}

interface SearchPanelHeightInput {
  contentHeight: number
  minHeight: number
  maxHeight: number
  compact: boolean
}

interface SearchPanelBlockedInput {
  pluginOpen: boolean
  visiblePluginLaunch: boolean
  systemPageAttached: boolean
  attachmentsManagerOpen: boolean
}

interface EmptyLaunchSuggestionsInput extends SearchPanelBlockedInput {
  hasInput: boolean
  activationSessionIdle: boolean
}

interface SearchPanelVisibilityInput extends SearchPanelBlockedInput {
  hasInput: boolean
  showEmptyLaunchSuggestions: boolean
}

function isPanelBlocked({
  pluginOpen,
  visiblePluginLaunch,
  systemPageAttached,
  attachmentsManagerOpen
}: SearchPanelBlockedInput): boolean {
  return pluginOpen || visiblePluginLaunch || systemPageAttached || attachmentsManagerOpen
}

export function shouldShowEmptyLaunchSuggestions(input: EmptyLaunchSuggestionsInput): boolean {
  return !input.hasInput && input.activationSessionIdle && !isPanelBlocked(input)
}

export function shouldShowSearchPanel(input: SearchPanelVisibilityInput): boolean {
  return (input.hasInput || input.showEmptyLaunchSuggestions) && !isPanelBlocked(input)
}

export function getSearchPanelHeight({
  contentHeight,
  minHeight,
  maxHeight,
  compact
}: SearchPanelHeightInput): number {
  const lowerBound = compact ? 0 : minHeight
  return Math.min(Math.max(contentHeight, lowerBound), maxHeight)
}

export function shouldResetSearchPanelHeight({
  hasInput,
  showSearchPanel
}: SearchPanelResetInput): boolean {
  return !hasInput && !showSearchPanel
}
