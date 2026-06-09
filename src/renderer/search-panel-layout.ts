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
  showSearchPanel
}: SearchPanelResetInput): boolean {
  // 只要面板当前不可见就重置测量高度——无论是输入清空后隐藏，还是被附着插件 /
  // 系统页 / 附件管理器遮挡（此时即便仍有输入文本，面板也不显示）。这样面板下次
  // 重新出现时会等待 ResizeObserver 重新测量，避免沿用上一次的旧高度先撑开再回缩
  // 造成"闪一下"（例如关闭附着插件后高度从 150 跳回最近打开的 100）。
  return !showSearchPanel
}
