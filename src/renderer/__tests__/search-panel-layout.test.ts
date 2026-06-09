import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getReportedPanelHeight,
  getSearchPanelHeight,
  shouldResetSearchPanelHeight,
  shouldShowEmptyLaunchSuggestions,
  shouldShowSearchPanel
} from '../search-panel-layout'

describe('search panel layout policy', () => {
  it('shows empty launch suggestions only for a fresh idle activation session', () => {
    assert.equal(
      shouldShowEmptyLaunchSuggestions({
        hasInput: false,
        activationSessionIdle: true,
        pluginOpen: false,
        visiblePluginLaunch: false,
        systemPageAttached: false,
        attachmentsManagerOpen: false
      }),
      true
    )
  })

  it('does not show empty launch suggestions after the user edited and cleared input', () => {
    assert.equal(
      shouldShowEmptyLaunchSuggestions({
        hasInput: false,
        activationSessionIdle: false,
        pluginOpen: false,
        visiblePluginLaunch: false,
        systemPageAttached: false,
        attachmentsManagerOpen: false
      }),
      false
    )
  })

  it('does not show empty launch suggestions while normal input exists', () => {
    assert.equal(
      shouldShowEmptyLaunchSuggestions({
        hasInput: true,
        activationSessionIdle: true,
        pluginOpen: false,
        visiblePluginLaunch: false,
        systemPageAttached: false,
        attachmentsManagerOpen: false
      }),
      false
    )
  })

  it('shows the search panel for input or for an idle empty launch session', () => {
    assert.equal(
      shouldShowSearchPanel({
        hasInput: true,
        showEmptyLaunchSuggestions: false,
        pluginOpen: false,
        visiblePluginLaunch: false,
        systemPageAttached: false,
        attachmentsManagerOpen: false
      }),
      true
    )
    assert.equal(
      shouldShowSearchPanel({
        hasInput: false,
        showEmptyLaunchSuggestions: true,
        pluginOpen: false,
        visiblePluginLaunch: false,
        systemPageAttached: false,
        attachmentsManagerOpen: false
      }),
      true
    )
  })

  it('hides the search panel after input is cleared in a dirty activation session', () => {
    assert.equal(
      shouldShowSearchPanel({
        hasInput: false,
        showEmptyLaunchSuggestions: false,
        pluginOpen: false,
        visiblePluginLaunch: false,
        systemPageAttached: false,
        attachmentsManagerOpen: false
      }),
      false
    )
  })

  it('keeps the measured panel height when an empty-input search panel is still visible', () => {
    assert.equal(
      shouldResetSearchPanelHeight({
        hasInput: false,
        showSearchPanel: true
      }),
      false
    )
  })

  it('resets the measured panel height after the search panel is hidden', () => {
    assert.equal(
      shouldResetSearchPanelHeight({
        hasInput: false,
        showSearchPanel: false
      }),
      true
    )
  })

  it('resets the measured panel height while hidden by an attached plugin even if input remains', () => {
    // 回归：附着插件常带着搜索文本启动(hasInput=true)且面板被遮挡(showSearchPanel=false)，
    // 必须重置高度，否则关闭插件后会用旧高度(如 150)先撑开再缩回最近打开(100)造成闪烁。
    assert.equal(
      shouldResetSearchPanelHeight({
        hasInput: true,
        showSearchPanel: false
      }),
      true
    )
  })

  it('uses measured height for compact empty launch suggestions', () => {
    assert.equal(
      getSearchPanelHeight({
        contentHeight: 56,
        minHeight: 120,
        maxHeight: 737,
        compact: true
      }),
      56
    )
  })

  it('keeps the normal minimum height for regular search results', () => {
    assert.equal(
      getSearchPanelHeight({
        contentHeight: 56,
        minHeight: 120,
        maxHeight: 737,
        compact: false
      }),
      120
    )
  })

  it('reports 0 height while empty-launch suggestions are still loading (no flash)', () => {
    // 回归：唤起宿主 / 关闭附着插件后，PluginList 重新挂载，最近项加载完成前只有
    // "正在搜索…"占位（hasRenderableItems=false）。此时必须上报 0 而非占位高度，
    // 否则会被父窗口的 120 最小高度撑大，待最近项就绪后再缩回，造成"闪一下"。
    assert.deepEqual(
      getReportedPanelHeight({
        rawContentHeight: 104,
        emptyLaunchSuggestionMode: true,
        hasRenderableItems: false,
        onlyRecentSection: false
      }),
      { height: 0, compact: true }
    )
  })

  it('reports the recent-bar height as compact once recent items have loaded', () => {
    // 最近项就绪后：一次性增高到其真实高度，且 compact（无 120 最小高度），
    // 因此窗口只"增高"一次，不再出现撑大→缩回的中间态。
    assert.deepEqual(
      getReportedPanelHeight({
        rawContentHeight: 52,
        emptyLaunchSuggestionMode: true,
        hasRenderableItems: true,
        onlyRecentSection: true
      }),
      { height: 52, compact: true }
    )
  })

  it('reports non-compact height when empty-launch mode also surfaces non-recent matches', () => {
    // 空闲建议模式下若出现窗口匹配等非"最近使用"分区，应回到普通（非 compact）高度，
    // 以便父窗口套用最小高度展示完整结果。
    assert.deepEqual(
      getReportedPanelHeight({
        rawContentHeight: 80,
        emptyLaunchSuggestionMode: true,
        hasRenderableItems: true,
        onlyRecentSection: false
      }),
      { height: 80, compact: false }
    )
  })

  it('reports raw height in query mode even before results arrive (keeps searching/empty box)', () => {
    // 用户输入搜索（非建议模式）：即使结果未到也上报真实占位高度（非 0），
    // 由父窗口套用最小高度，保证"正在搜索…/没有匹配结果"提示框可见。
    assert.deepEqual(
      getReportedPanelHeight({
        rawContentHeight: 104,
        emptyLaunchSuggestionMode: false,
        hasRenderableItems: false,
        onlyRecentSection: false
      }),
      { height: 104, compact: false }
    )
  })
})
