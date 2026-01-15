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
      return { type: 'regex', match: cmd.match, explain: cmd.explain }
    case 'files':
      if (!Array.isArray(cmd.exts) || cmd.exts.length === 0) {
        throw new Error('Files command requires exts')
      }
      return { type: 'files', exts: cmd.exts }
    case 'img':
      return { type: 'img' }
    case 'over':
      return { type: 'over' }
    default:
      throw new Error(`Unsupported command type: ${cmd.type}`)
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

  constructor() {
    this.load()
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
      route: feature.route
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
    return true
  }

  clearFeatures(pluginId: string): void {
    delete this.data[pluginId]
    this.save()
  }
}

export const pluginFeatureStore = new PluginFeatureStore()

export function redirectHotKeySetting(cmdLabel: string): void {
  new Notification({
    title: 'InTools',
    body: `Shortcut settings are not available yet. Use api.shortcut.register for "${cmdLabel}".`
  }).show()
}

export function redirectAiModelsSetting(): void {
  new Notification({
    title: 'InTools',
    body: 'AI model settings are not available yet.'
  }).show()
}
