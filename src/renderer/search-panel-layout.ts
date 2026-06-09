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

interface ReportedPanelHeightInput {
  rawContentHeight: number
  emptyLaunchSuggestionMode: boolean
  hasRenderableItems: boolean
  onlyRecentSection: boolean
}

interface ReportedPanelHeight {
  height: number
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

/**
 * 决定 PluginList 应向父窗口上报的面板高度与是否 compact。
 *
 * 修复"唤起宿主 / 关闭附着插件后面板高度先撑大再缩回最近打开"的闪烁：
 * 空闲建议模式（无输入、只为展示"最近使用"）下，当最近项尚未加载完成、当前只有
 * "正在搜索…"占位（hasRenderableItems=false）时，上报 0 高度让窗口保持搜索框高度；
 * 待最近项就绪后再一次性增高到其真实高度（compact，无 120 最小高度），从而只"增高"
 * 一次、不再经历"撑到占位高度→缩回最近高度"的中间态。
 *
 * 非建议模式（用户在输入搜索）保持原行为：上报真实测量高度，由父窗口套用最小高度，
 * 以便加载/无结果时仍显示"正在搜索…/没有匹配结果"提示框。
 */
export function getReportedPanelHeight({
  rawContentHeight,
  emptyLaunchSuggestionMode,
  hasRenderableItems,
  onlyRecentSection
}: ReportedPanelHeightInput): ReportedPanelHeight {
  if (emptyLaunchSuggestionMode && !hasRenderableItems) {
    return { height: 0, compact: true }
  }
  const compact = emptyLaunchSuggestionMode && onlyRecentSection
  return { height: rawContentHeight, compact }
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
