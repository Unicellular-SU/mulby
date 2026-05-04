import { app, Notification } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DynamicCmdInput, DynamicFeature, DynamicFeatureInput, PluginCmd, PluginFeature } from '../../shared/types/plugin'

type FeatureStoreData = Record<string, DynamicFeature[]>

const storePath = (() => {
  const configDir = app.getPath('userData')
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  return join(configDir, 'plugin-features.json')
})()

let hotKeySettingRedirectHandler: ((cmdLabel: string, autocopy?: boolean) => void) | null = null

function normalizeCmd(cmd: DynamicCmdInput): PluginCmd {
  if (typeof cmd === 'string') {
    return { type: 'keyword', value: cmd }
  }

  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
    throw new Error('Invalid command definition')
  }

  switch (cmd.type) {
    case 'keyword':
      if (!cmd.value) {
        throw new Error('Keyword command requires value')
      }
      return { type: 'keyword', value: cmd.value }
    case 'regex':
      if (!cmd.match) {
        throw new Error('Regex command requires match')
      }
      return {
        type: 'regex',
        match: cmd.match,
        explain: cmd.explain,
        label: cmd.label,
        minLength: cmd.minLength,
        maxLength: cmd.maxLength
      }
    case 'files':
      // exts 和 match 至少有一个，或者只指定 fileType
      if (!cmd.exts && !cmd.match && !cmd.fileType) {
        throw new Error('Files command requires exts, match, or fileType')
      }
      return {
        type: 'files',
        label: cmd.label,
        exts: cmd.exts,
        fileType: cmd.fileType,
        match: cmd.match,
        minLength: cmd.minLength,
        maxLength: cmd.maxLength
      }
    case 'img':
      if (cmd.exts && (!Array.isArray(cmd.exts) || cmd.exts.length === 0)) {
        throw new Error('Img command exts must be a non-empty array')
      }
      return { type: 'img', label: cmd.label, exts: cmd.exts }
    case 'over':
      return {
        type: 'over',
        label: cmd.label,
        exclude: cmd.exclude,
        minLength: cmd.minLength,
        maxLength: cmd.maxLength
      }
    case 'window':
      if (!cmd.app && !cmd.title && !cmd.bundleId) {
        throw new Error('Window command requires at least one of: app, title, bundleId')
      }
      return {
        type: 'window',
        label: cmd.label,
        app: cmd.app,
        title: cmd.title,
        bundleId: cmd.bundleId
      }
    default:
      throw new Error(`Unknown command type: ${(cmd as { type: string }).type}`)
  }
}

function normalizeFeature(input: DynamicFeatureInput): DynamicFeature {
  if (!input || typeof input !== 'object') {
    throw new Error('Feature payload is required')
  }
  if (!input.code || typeof input.code !== 'string') {
    throw new Error('Feature code is required')
  }
  if (!Array.isArray(input.cmds) || input.cmds.length === 0) {
    throw new Error('Feature cmds must be a non-empty array')
  }

  const cmds = input.cmds.map(normalizeCmd)

  return {
    code: input.code,
    explain: input.explain ?? input.code,
    icon: input.icon,
    platform: input.platform,
    mode: input.mode,
    route: input.route,
    mainHide: input.mainHide,
    mainPush: input.mainPush,
    cmds
  }
}

function matchesPlatform(feature: DynamicFeature): boolean {
  if (!feature.platform) return true
  const platforms = Array.isArray(feature.platform) ? feature.platform : [feature.platform]
  return platforms.includes(process.platform)
}

class PluginFeatureStore {
  private data: FeatureStoreData = {}
  // 变更回调，用于通知外部（如搜索 Worker）同步
  private changeListeners: Set<() => void> = new Set()

  constructor() {
    this.load()
  }

  onChange(listener: () => void): void {
    this.changeListeners.add(listener)
  }

  offChange(listener: () => void): void {
    this.changeListeners.delete(listener)
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      try { listener() } catch { /* ignore */ }
    }
  }

  private load(): void {
    if (!existsSync(storePath)) return
    try {
      const raw = readFileSync(storePath, 'utf-8')
      this.data = JSON.parse(raw) as FeatureStoreData
    } catch {
      this.data = {}
    }
  }

  private save(): void {
    writeFileSync(storePath, JSON.stringify(this.data, null, 2))
  }

  getFeatures(pluginId: string, codes?: string[], includeAllPlatforms = false): DynamicFeature[] {
    const list = this.data[pluginId] || []
    const filtered = includeAllPlatforms ? list : list.filter(matchesPlatform)
    const byCode = codes?.length ? filtered.filter((feature) => codes.includes(feature.code)) : filtered
    return byCode.map((feature) => ({
      ...feature,
      cmds: feature.cmds.map((cmd) => ({ ...cmd }))
    }))
  }

  getPluginFeatures(pluginId: string): PluginFeature[] {
    return this.getFeatures(pluginId).map((feature) => ({
      code: feature.code,
      explain: feature.explain,
      cmds: feature.cmds,
      mode: feature.mode,
      route: feature.route,
      icon: feature.icon,
      mainHide: feature.mainHide,
      mainPush: feature.mainPush
    }))
  }

  setFeature(pluginId: string, input: DynamicFeatureInput): DynamicFeature {
    const feature = normalizeFeature(input)
    const list = this.data[pluginId] || []
    const index = list.findIndex((item) => item.code === feature.code)

    if (index >= 0) {
      list[index] = feature
    } else {
      list.push(feature)
    }

    this.data[pluginId] = list
    this.save()
    this.notifyChange()
    return feature
  }

  removeFeature(pluginId: string, code: string): boolean {
    const list = this.data[pluginId] || []
    const next = list.filter((item) => item.code !== code)

    if (next.length === list.length) {
      return false
    }

    if (next.length === 0) {
      delete this.data[pluginId]
    } else {
      this.data[pluginId] = next
    }

    this.save()
    this.notifyChange()
    return true
  }

  clearFeatures(pluginId: string): void {
    delete this.data[pluginId]
    this.save()
  }
}

export const pluginFeatureStore = new PluginFeatureStore()

export function setHotKeySettingRedirectHandler(handler: ((cmdLabel: string, autocopy?: boolean) => void) | null): void {
  hotKeySettingRedirectHandler = handler
}

export function redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): void {
  if (hotKeySettingRedirectHandler) {
    hotKeySettingRedirectHandler(cmdLabel, autocopy)
    return
  }

  new Notification({
    title: app.getName() || 'Mulby',
    body: `Shortcut settings are not available yet. Use api.shortcut.register for "${cmdLabel}".`
  }).show()
}

export function redirectAiModelsSetting(): void {
  new Notification({
    title: app.getName() || 'Mulby',
    body: 'AI model settings are not available yet.'
  }).show()
}

// ====== MainPush 注册表 ======

export interface MainPushAction {
  code: string
  type: string
  payload: string
}

export interface MainPushItem {
  icon?: string
  title: string
  text: string
  [key: string]: unknown
}

type MainPushCallback = (action: MainPushAction) => MainPushItem[] | Promise<MainPushItem[]>
type MainPushSelectCallback = (action: MainPushAction & { option: MainPushItem }) => boolean | Promise<boolean>

const mainPushHandlers = new Map<string, MainPushCallback>()
const mainPushSelectHandlers = new Map<string, MainPushSelectCallback>()

export function registerMainPushHandler(pluginName: string, callback: MainPushCallback): void {
  mainPushHandlers.set(pluginName, callback)
}

export function registerMainPushSelectHandler(pluginName: string, callback: MainPushSelectCallback): void {
  mainPushSelectHandlers.set(pluginName, callback)
}

export function unregisterMainPushHandlers(pluginName: string): void {
  mainPushHandlers.delete(pluginName)
  mainPushSelectHandlers.delete(pluginName)
}

export async function queryMainPush(pluginName: string, action: MainPushAction): Promise<MainPushItem[]> {
  const handler = mainPushHandlers.get(pluginName)
  if (!handler) return []
  try {
    const result = await handler(action)
    return Array.isArray(result) ? result : []
  } catch {
    return []
  }
}

export async function handleMainPushSelect(pluginName: string, action: MainPushAction & { option: MainPushItem }): Promise<boolean> {
  const handler = mainPushSelectHandlers.get(pluginName)
  if (!handler) return true
  try {
    return await handler(action)
  } catch {
    return true
  }
}

export function hasMainPushHandler(pluginName: string): boolean {
  return mainPushHandlers.has(pluginName)
}
