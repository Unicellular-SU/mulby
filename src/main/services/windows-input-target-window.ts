const inputTargetWindowHandlesById = new Map<number, bigint>()

type AddressResolver = (value: unknown) => bigint

export function nativeWindowHandleBufferToBigInt(handle: Buffer): bigint | null {
  if (handle.byteLength >= 8) return handle.readBigUInt64LE(0)
  if (handle.byteLength >= 4) return BigInt(handle.readUInt32LE(0))
  return null
}

export function normalizeWindowsNativeWindowHandle(
  nativeWindowHandle: unknown,
  resolveAddress: AddressResolver = (value) => require('koffi').address(value) as bigint
): bigint | null {
  if (typeof nativeWindowHandle === 'bigint') return nativeWindowHandle
  if (typeof nativeWindowHandle === 'number') return BigInt(nativeWindowHandle)
  if (Buffer.isBuffer(nativeWindowHandle)) return nativeWindowHandleBufferToBigInt(nativeWindowHandle)
  if (!nativeWindowHandle) return null

  try {
    return resolveAddress(nativeWindowHandle)
  } catch {
    return null
  }
}

export function registerWindowsInputTargetWindow(windowId: number, nativeWindowHandle: Buffer): void {
  const handle = normalizeWindowsNativeWindowHandle(nativeWindowHandle)
  if (!handle || handle === 0n) return
  inputTargetWindowHandlesById.set(windowId, handle)
}

export function unregisterWindowsInputTargetWindow(windowId: number): void {
  inputTargetWindowHandlesById.delete(windowId)
}

export function isWindowsInputTargetWindowHandle(nativeWindowHandle: unknown): boolean {
  const handle = normalizeWindowsNativeWindowHandle(nativeWindowHandle)
  if (!handle) return false
  for (const registeredHandle of inputTargetWindowHandlesById.values()) {
    if (registeredHandle === handle) return true
  }
  return false
}

export function clearWindowsInputTargetWindows(): void {
  inputTargetWindowHandlesById.clear()
}
