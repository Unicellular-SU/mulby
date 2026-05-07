const pinnedSizes = new Map<number, { width: number; height: number }>()

export function pinWindowSize(windowId: number, width: number, height: number): void {
  pinnedSizes.set(windowId, { width, height })
}

export function unpinWindowSize(windowId: number): void {
  pinnedSizes.delete(windowId)
}

export function updatePinnedSize(windowId: number, width: number, height: number): void {
  pinnedSizes.set(windowId, { width, height })
}

export function getPinnedSize(windowId: number): { width: number; height: number } | undefined {
  return pinnedSizes.get(windowId)
}
