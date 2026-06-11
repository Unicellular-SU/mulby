export interface NativeDisplayLike {
  id: number
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
}

export interface ElectronDisplayLike {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

export interface RegionBounds {
  x: number
  y: number
  width: number
  height: number
}

function nearlyEqual(left: number, right: number, tolerance = 2): boolean {
  return Math.abs(left - right) <= tolerance
}

function containsPoint(display: NativeDisplayLike, x: number, y: number): boolean {
  return x >= display.x
    && x < display.x + display.width
    && y >= display.y
    && y < display.y + display.height
}

function matchElectronDisplay(
  nativeDisplay: NativeDisplayLike,
  electronDisplays: ElectronDisplayLike[]
): ElectronDisplayLike | undefined {
  return electronDisplays.find((display) => {
    const scaleFactor = nativeDisplay.scaleFactor || display.scaleFactor || 1
    return nearlyEqual(nativeDisplay.x, display.bounds.x * scaleFactor)
      && nearlyEqual(nativeDisplay.y, display.bounds.y * scaleFactor)
      && nearlyEqual(nativeDisplay.width, display.bounds.width * scaleFactor)
      && nearlyEqual(nativeDisplay.height, display.bounds.height * scaleFactor)
  }) ?? electronDisplays.find((display) => nearlyEqual(display.scaleFactor || 1, nativeDisplay.scaleFactor || 1))
}

/**
 * 在原生 getDisplays() 返回的列表中查找与给定矩形吻合的显示器下标。
 *
 * rect 必须与原生显示器 bounds 使用同一坐标系（macOS 为全局逻辑坐标，
 * Windows/Linux 为物理像素坐标），由调用方负责换算。
 */
export function findNativeDisplayIndexByRect(
  rect: RegionBounds,
  nativeDisplays: NativeDisplayLike[],
  tolerance = 2
): number | null {
  const index = nativeDisplays.findIndex((display) =>
    nearlyEqual(display.x, rect.x, tolerance)
    && nearlyEqual(display.y, rect.y, tolerance)
    && nearlyEqual(display.width, rect.width, tolerance)
    && nearlyEqual(display.height, rect.height, tolerance)
  )
  return index >= 0 ? index : null
}

export function nativePhysicalRegionToDip(
  region: RegionBounds,
  nativeDisplays: NativeDisplayLike[],
  electronDisplays: ElectronDisplayLike[]
): RegionBounds {
  const centerX = region.x + region.width / 2
  const centerY = region.y + region.height / 2
  const nativeDisplay = nativeDisplays.find((display) => containsPoint(display, centerX, centerY))
    ?? nativeDisplays.find((display) => containsPoint(display, region.x, region.y))
  if (!nativeDisplay) return region

  const electronDisplay = matchElectronDisplay(nativeDisplay, electronDisplays)
  if (!electronDisplay) return region

  const scaleFactor = nativeDisplay.scaleFactor || electronDisplay.scaleFactor || 1
  return {
    x: Math.round(electronDisplay.bounds.x + ((region.x - nativeDisplay.x) / scaleFactor)),
    y: Math.round(electronDisplay.bounds.y + ((region.y - nativeDisplay.y) / scaleFactor)),
    width: Math.max(1, Math.round(region.width / scaleFactor)),
    height: Math.max(1, Math.round(region.height / scaleFactor))
  }
}
