import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const floatingBallSectionPath = join(
  process.cwd(),
  'src/renderer/components/settings/sections/FloatingBallSection.tsx'
)

describe('floating ball settings action UI', () => {
  it('uses a searchable action picker instead of a select for gesture actions', () => {
    const source = readFileSync(floatingBallSectionPath, 'utf8')

    assert.doesNotMatch(source, /<select[\s\S]*doubleClickCommand/, 'gesture actions must not use a long select dropdown')
    assert.match(source, /actionSearch/i, 'action picker should keep a search query state')
    assert.match(source, /placeholder="搜索插件功能"/, 'action picker should expose a plugin command search input')
    assert.match(source, /builtinActions/, 'action picker should list built-in actions')
    assert.match(source, /accept="\.svg,image\/svg\+xml"/, 'custom icon upload should only accept SVG files')
    assert.match(source, /normalizeFloatingBallCustomSvg/, 'custom icon upload should validate SVG content before saving')
    assert.match(
      source,
      /commandKind === 'launch'[\s\S]*!item\.disabled/,
      'action picker should only offer enabled launch commands'
    )
    assert.match(
      source,
      /command\.disabled \|\| command\.commandKind !== 'launch'/,
      'existing bindings to disabled or non-launch commands should be shown as unavailable'
    )
    assert.doesNotMatch(
      source,
      /bg-slate-950\/30[\s\S]*选择\{gestureRows\.find/,
      'action picker should not draw a dimming backdrop'
    )
    assert.doesNotMatch(
      source,
      /bg-slate-950\/40[\s\S]*选择\{gestureRows\.find/,
      'action picker should not draw a dimming backdrop'
    )
    assert.match(
      source,
      /fixed left-56 right-0 top-\[73px\] bottom-0[\s\S]*bg-transparent[\s\S]*onClick=\{closeActionPicker\}[\s\S]*max-w-xl[\s\S]*max-h-\[min\(560px,calc\(100vh-120px\)\)\][\s\S]*onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
      'action picker should use a fixed transparent backdrop centered in the right settings pane'
    )
  })
})
