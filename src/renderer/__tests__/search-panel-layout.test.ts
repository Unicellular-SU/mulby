import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
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
})
