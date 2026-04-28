import { app } from 'electron'
import log from 'electron-log'
import { join } from 'path'

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

  try {
    const addonPath = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'native', 'build', 'Release', 'finder_selection.node')
      : join(app.getAppPath(), 'native', 'build', 'Release', 'finder_selection.node')

    cachedAddon = require(addonPath) as FinderSelectionAddon
    log.info('[FinderSelection] 原生模块加载成功')
    return cachedAddon
  } catch (err) {
    cachedAddon = null
    log.warn('[FinderSelection] 原生模块加载失败，将使用剪贴板回退:', err)
    return null
  }
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
