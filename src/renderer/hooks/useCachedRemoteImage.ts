import { useEffect, useState } from 'react'

const REMOTE_IMAGE_CACHE_NAME = 'mulby-remote-images-v1'
const objectUrlCache = new Map<string, string>()
const pendingCache = new Map<string, Promise<string | null>>()

let cleanupRegistered = false

function registerObjectUrlCleanup() {
  if (cleanupRegistered || typeof window === 'undefined') return
  cleanupRegistered = true
  window.addEventListener('beforeunload', () => {
    for (const objectUrl of objectUrlCache.values()) {
      URL.revokeObjectURL(objectUrl)
    }
    objectUrlCache.clear()
  }, { once: true })
}

function getCachedObjectUrl(url: string): string | null {
  return objectUrlCache.get(url) || null
}

function rememberObjectUrl(url: string, blob: Blob): string {
  const existing = getCachedObjectUrl(url)
  if (existing) return existing
  const objectUrl = URL.createObjectURL(blob)
  objectUrlCache.set(url, objectUrl)
  registerObjectUrlCleanup()
  return objectUrl
}

async function openRemoteImageCache(): Promise<Cache | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null
  try {
    return await window.caches.open(REMOTE_IMAGE_CACHE_NAME)
  } catch {
    return null
  }
}

async function loadCachedRemoteImage(url: string): Promise<string | null> {
  const cachedObjectUrl = getCachedObjectUrl(url)
  if (cachedObjectUrl) return cachedObjectUrl

  const pending = pendingCache.get(url)
  if (pending) return pending

  const task = (async () => {
    const cache = await openRemoteImageCache()
    const cachedResponse = cache ? await cache.match(url) : null
    if (cachedResponse) {
      return rememberObjectUrl(url, await cachedResponse.blob())
    }

    const response = await fetch(url, { cache: 'force-cache', mode: 'cors' })
    if (!response.ok) {
      throw new Error(`Failed to fetch remote image: ${response.status}`)
    }

    if (cache) {
      await cache.put(url, response.clone())
    }

    return rememberObjectUrl(url, await response.blob())
  })()
    .catch(() => null)
    .finally(() => {
      pendingCache.delete(url)
    })

  pendingCache.set(url, task)
  return task
}

export default function useCachedRemoteImage(url?: string | null): string | null {
  const [src, setSrc] = useState<string | null>(() => {
    if (!url) return null
    return getCachedObjectUrl(url) || url
  })

  useEffect(() => {
    let cancelled = false
    if (!url) {
      setSrc(null)
      return
    }

    setSrc(getCachedObjectUrl(url) || url)

    void loadCachedRemoteImage(url).then((cachedSrc) => {
      if (!cancelled && cachedSrc) {
        setSrc(cachedSrc)
      }
    })

    return () => {
      cancelled = true
    }
  }, [url])

  return src
}
