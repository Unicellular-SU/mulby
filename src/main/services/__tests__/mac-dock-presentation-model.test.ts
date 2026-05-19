import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMacDockMenuModel,
  resolveMacDockPresentation,
  sortDockPluginWindows,
  type MacDockPluginWindowSnapshot
} from '../mac-dock-presentation-model'

function pluginWindow(input: Partial<MacDockPluginWindowSnapshot> & {
  windowId: number
  pluginId: string
  displayName: string
}): MacDockPluginWindowSnapshot {
  return {
    startedAt: 100,
    lastFocusedAt: 100,
    ...input
  }
}

describe('macOS Dock presentation model', () => {
  it('hides Dock when no detached app surface exists', () => {
    const presentation = resolveMacDockPresentation({
      pluginWindows: [],
      hasSystemDetachedWindow: false
    })

    assert.equal(presentation.mode, 'hidden')
    assert.equal(presentation.badge, '')
    assert.equal(presentation.representativePluginWindow, null)
    assert.deepEqual(buildMacDockMenuModel(presentation), [])
  })

  it('uses the most recently focused plugin as the representative', () => {
    const older = pluginWindow({
      windowId: 1,
      pluginId: 'old',
      displayName: 'Older',
      startedAt: 100,
      lastFocusedAt: 150
    })
    const newer = pluginWindow({
      windowId: 2,
      pluginId: 'new',
      displayName: 'Newer',
      startedAt: 110,
      lastFocusedAt: 300
    })

    const presentation = resolveMacDockPresentation({
      pluginWindows: [older, newer],
      hasSystemDetachedWindow: false
    })

    assert.equal(presentation.mode, 'plugin')
    assert.equal(presentation.representativePluginWindow?.pluginId, 'new')
    assert.equal(presentation.badge, '2')
    assert.deepEqual(sortDockPluginWindows([older, newer]).map((item) => item.pluginId), ['new', 'old'])
  })

  it('keeps the system Dock identity while preserving plugin menu entries', () => {
    const presentation = resolveMacDockPresentation({
      pluginWindows: [
        pluginWindow({
          windowId: 7,
          pluginId: 'translator',
          displayName: 'Translator'
        })
      ],
      hasSystemDetachedWindow: true
    })

    const menu = buildMacDockMenuModel(presentation)

    assert.equal(presentation.mode, 'system')
    assert.equal(presentation.representativePluginWindow, null)
    assert.deepEqual(menu.map((item) => item.type), [
      'plugin-window',
      'separator',
      'open-main-window',
      'quit-app'
    ])
  })

  it('adds a close-all action only when multiple plugin groups exist', () => {
    const single = buildMacDockMenuModel(resolveMacDockPresentation({
      pluginWindows: [
        pluginWindow({ windowId: 1, pluginId: 'one', displayName: 'One' })
      ],
      hasSystemDetachedWindow: false
    }))
    const multiple = buildMacDockMenuModel(resolveMacDockPresentation({
      pluginWindows: [
        pluginWindow({ windowId: 1, pluginId: 'one', displayName: 'One' }),
        pluginWindow({ windowId: 2, pluginId: 'two', displayName: 'Two' })
      ],
      hasSystemDetachedWindow: false
    }))

    assert.equal(single.some((item) => item.type === 'close-all-plugin-windows'), false)
    assert.equal(multiple.some((item) => item.type === 'close-all-plugin-windows'), true)
  })

  it('groups multiple windows from the same plugin into one Dock item', () => {
    const presentation = resolveMacDockPresentation({
      pluginWindows: [
        pluginWindow({
          windowId: 1,
          pluginId: 'desktop-pet',
          displayName: '桌面宠物',
          startedAt: 100,
          lastFocusedAt: 200
        }),
        pluginWindow({
          windowId: 2,
          pluginId: 'desktop-pet',
          displayName: '桌面宠物',
          startedAt: 110,
          lastFocusedAt: 500
        }),
        pluginWindow({
          windowId: 3,
          pluginId: 'desktop-pet',
          displayName: '桌面宠物',
          startedAt: 120,
          lastFocusedAt: 300
        })
      ],
      hasSystemDetachedWindow: false
    })

    const menu = buildMacDockMenuModel(presentation)
    const pluginItems = menu.filter((item) => item.type === 'plugin-window')

    assert.equal(presentation.badge, '')
    assert.equal(pluginItems.length, 1)
    assert.deepEqual(pluginItems[0], {
      type: 'plugin-window',
      windowId: 2,
      windowIds: [2, 3, 1],
      pluginId: 'desktop-pet',
      label: '桌面宠物'
    })
    assert.equal(menu.some((item) => item.type === 'close-all-plugin-windows'), false)
  })
})
