import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findNativeDisplayIndexByRect, nativePhysicalRegionToDip } from '../screen-coordinate-utils'

describe('nativePhysicalRegionToDip', () => {
  it('converts Windows native physical capture bounds to Electron DIP bounds', () => {
    const converted = nativePhysicalRegionToDip(
      { x: 150, y: 225, width: 900, height: 600 },
      [{ id: 0, x: 0, y: 0, width: 2880, height: 1620, scaleFactor: 1.5 }],
      [{ id: 10, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 }]
    )

    assert.deepEqual(converted, { x: 100, y: 150, width: 600, height: 400 })
  })

  it('converts coordinates relative to a scaled secondary display origin', () => {
    const converted = nativePhysicalRegionToDip(
      { x: 2100, y: 300, width: 600, height: 300 },
      [{ id: 0, x: 1920, y: 0, width: 2880, height: 1620, scaleFactor: 1.5 }],
      [{ id: 11, bounds: { x: 1280, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 }]
    )

    assert.deepEqual(converted, { x: 1400, y: 200, width: 400, height: 200 })
  })
})

describe('findNativeDisplayIndexByRect', () => {
  const nativeDisplays = [
    { id: 0, x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 },
    { id: 1, x: 1920, y: 0, width: 2880, height: 1620, scaleFactor: 1.5 }
  ]

  it('finds the display whose bounds match the rect exactly', () => {
    const index = findNativeDisplayIndexByRect(
      { x: 1920, y: 0, width: 2880, height: 1620 },
      nativeDisplays
    )

    assert.equal(index, 1)
  })

  it('tolerates rounding differences within the tolerance', () => {
    const index = findNativeDisplayIndexByRect(
      { x: 1918, y: 1, width: 2882, height: 1619 },
      nativeDisplays
    )

    assert.equal(index, 1)
  })

  it('returns null when no display matches', () => {
    const index = findNativeDisplayIndexByRect(
      { x: 0, y: 0, width: 800, height: 600 },
      nativeDisplays
    )

    assert.equal(index, null)
  })
})
