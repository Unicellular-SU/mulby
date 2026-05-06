export interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
}

interface DataUrlImageLike {
  toDataURL(): string
}

export interface RawCaptureSourceLike {
  id: string
  name: string
  thumbnail: DataUrlImageLike
  display_id?: string
  appIcon?: DataUrlImageLike | null
}

export interface PublicCaptureSource {
  id: string
  name: string
  thumbnailDataUrl: string
  displayId?: string
  appIconDataUrl?: string
  bounds?: CaptureBounds
}

export function parseDesktopCapturerWindowId(sourceId: string | null | undefined): number | null {
  if (typeof sourceId !== 'string') return null

  const match = /^window:(\d+):\d+$/.exec(sourceId)
  if (!match) return null

  const windowId = Number(match[1])
  if (!Number.isSafeInteger(windowId) || windowId <= 0 || windowId > 0xffffffff) return null

  return windowId
}

export function normalizeCaptureBounds(bounds: CaptureBounds | null | undefined): CaptureBounds | null {
  if (!bounds) return null

  const { x, y, width, height } = bounds
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }

  return { x, y, width, height }
}

export function createPublicCaptureSource(
  source: RawCaptureSourceLike,
  bounds?: CaptureBounds | null
): PublicCaptureSource {
  const output: PublicCaptureSource = {
    id: source.id,
    name: source.name,
    thumbnailDataUrl: source.thumbnail.toDataURL(),
    displayId: source.display_id || undefined,
    appIconDataUrl: source.appIcon ? source.appIcon.toDataURL() : undefined
  }

  const normalizedBounds = normalizeCaptureBounds(bounds)
  if (normalizedBounds) {
    output.bounds = normalizedBounds
  }

  return output
}
