/**
 * Plugin WebContentsView shell pool (P4)
 *
 * 类比 Host 进程池：预创建少量"默认 profile"的空白 WebContentsView 外壳，
 * 打开默认 profile 插件面板时直接取用，省去 `new WebContentsView()` 的渲染进程
 * 冷启开销。
 *
 * 关键约束：WebContentsView 的 webPreferences 在创建时固定且**逐插件不同**
 * （preload / contextIsolation / sandbox 依据 custom preload；webview 权限决定
 * webviewTag）。因此池**只**对"默认 profile"（无自定义 preload、无 webview 权限）
 * 的插件复用；其余插件仍按需新建。fail-open：任意异常都回退到新建。
 */

import { WebContentsView } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import type { Plugin } from '../../shared/types/plugin'
import { PLUGIN_RENDERER_V8_CACHE_OPTIONS } from './plugin-web-preferences'
import { computeHotStartBudget } from './hot-start-budget'
import { totalmem } from 'os'

let maxSize = computeHotStartBudget(totalmem()).pluginViewPoolSize
let pool: WebContentsView[] = []
let filling = false
let destroyed = false

/**
 * 纯判定：插件是否属于可池化的"默认 profile"。
 * 默认 profile = 无自定义 preload 且无 webview 权限 —— 此时 webPreferences
 * 与池内预建视图完全一致，可安全复用。
 */
export function isDefaultViewProfile(plugin: Plugin): boolean {
  return !plugin.manifest.preload && plugin.manifest.permissions?.webview !== true
}

function buildDefaultView(): WebContentsView {
  const basePreloadPath = join(__dirname, '../preload/index.js')
  return new WebContentsView({
    webPreferences: {
      preload: basePreloadPath,
      additionalArguments: ['--mulby-plugin-window'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      v8CacheOptions: PLUGIN_RENDERER_V8_CACHE_OPTIONS
    }
  })
}

export function setPluginViewPoolSize(size: number): void {
  maxSize = Math.max(0, Math.floor(size))
}

function fill(): void {
  if (destroyed || filling || pool.length >= maxSize) return
  filling = true
  try {
    while (pool.length < maxSize) {
      try {
        pool.push(buildDefaultView())
      } catch (err) {
        log.warn('[PluginViewPool] Failed to prebuild plugin view:', err)
        break
      }
    }
  } finally {
    filling = false
  }
}

/** 启动时预热外壳池（在 app ready 之后调用）。 */
export function prewarmPluginViewPool(): void {
  if (destroyed) return
  try {
    fill()
  } catch (err) {
    log.warn('[PluginViewPool] prewarm failed:', err)
  }
}

/**
 * 取一个默认 profile 的空白视图；无可用时返回 null（调用方应回退到新建）。
 * 取走后异步补池，维持稳态。
 */
export function acquireDefaultPluginView(): WebContentsView | null {
  if (destroyed) return null
  let view: WebContentsView | null = null
  while (pool.length > 0) {
    const candidate = pool.shift()!
    if (candidate.webContents && !candidate.webContents.isDestroyed()) {
      view = candidate
      break
    }
  }
  // 异步补池，避免阻塞当前面板创建
  setImmediate(() => fill())
  return view
}

export function destroyPluginViewPool(): void {
  destroyed = true
  for (const view of pool) {
    try {
      if (view.webContents && !view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    } catch {
      /* ignore */
    }
  }
  pool = []
}
