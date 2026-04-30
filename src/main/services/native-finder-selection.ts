import log from 'electron-log'
import { getNativeBuildAddonPathCandidates } from './native-addon-path'

interface FinderSelectionAddon {
  getSelectedPaths(): {
    paths?: string[]
    errorCode?: number
    errorMessage?: string
  }
}

let cachedAddon: FinderSelectionAddon | null | undefined = undefined

function loadAddon(): FinderSelectionAddon | null {
  if (cachedAddon !== undefined) return cachedAddon

  if (process.platform !== 'darwin') {
    cachedAddon = null
    return null
  }

  const attempts: Array<{ path: string; error: unknown }> = []

  for (const addonPath of getNativeBuildAddonPathCandidates('finder_selection.node')) {
    try {
      cachedAddon = require(addonPath) as FinderSelectionAddon
      log.info(`[FinderSelection] 原生模块加载成功: ${addonPath}`)
      return cachedAddon
    } catch (err) {
      attempts.push({ path: addonPath, error: err })
    }
  }

  cachedAddon = null
  log.warn('[FinderSelection] 原生模块加载失败，将使用剪贴板回退:', attempts)
  return null
}

export function getDarwinFinderSelectedPaths(): string[] {
  const addon = loadAddon()
  if (!addon) return []

  try {
    const result = addon.getSelectedPaths()
    if (result.errorCode || result.errorMessage) {
      log.info(`[FinderSelection] 读取 Finder 选区失败: code=${result.errorCode ?? 'unknown'}, message=${result.errorMessage || ''}`)
      return []
    }
    return Array.isArray(result.paths)
      ? result.paths.map((item) => item.trim()).filter(Boolean)
      : []
  } catch (err) {
    log.warn('[FinderSelection] 读取 Finder 选区异常，将使用剪贴板回退:', err)
    return []
  }
}
