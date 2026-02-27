import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  PluginCommandDisabledToggleInput,
  PluginCommandDisabledToggleResult
} from '../../shared/types/plugin'

type CommandTarget = Omit<PluginCommandDisabledToggleInput, 'disabled'>

interface DisabledCommandRecord extends CommandTarget {
  updatedAt: number
}

interface DisabledCommandStoreFile {
  disabledCommands: DisabledCommandRecord[]
}

function createTargetKey(target: CommandTarget): string {
  return `${target.pluginId}:${target.featureCode}:${target.cmdId}:${target.cmdSignature}`
}

export class PluginCommandDisabledManager {
  private readonly storePath: string
  private readonly records = new Map<string, DisabledCommandRecord>()

  constructor() {
    const configDir = app.getPath('userData')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.storePath = join(configDir, 'plugin-disabled-commands.json')
    this.load()
  }

  isDisabled(target: CommandTarget): boolean {
    if (this.records.has(createTargetKey(target))) {
      return true
    }

    for (const record of this.records.values()) {
      if (record.pluginId !== target.pluginId || record.featureCode !== target.featureCode) {
        continue
      }
      if (record.cmdSignature === target.cmdSignature || record.cmdId === target.cmdId) {
        return true
      }
    }
    return false
  }

  setDisabled(input: PluginCommandDisabledToggleInput): PluginCommandDisabledToggleResult {
    if (!input.disabled) {
      const removed = this.removeByTarget(input)
      if (removed) this.save()
      return {
        success: true,
        disabled: false
      }
    }

    this.records.set(createTargetKey(input), {
      pluginId: input.pluginId,
      featureCode: input.featureCode,
      cmdId: input.cmdId,
      cmdSignature: input.cmdSignature,
      updatedAt: Date.now()
    })
    this.save()
    return {
      success: true,
      disabled: true
    }
  }

  removeByPlugin(pluginId: string): void {
    let changed = false
    for (const [key, record] of this.records) {
      if (record.pluginId !== pluginId) continue
      this.records.delete(key)
      changed = true
    }
    if (changed) this.save()
  }

  private removeByTarget(target: CommandTarget): boolean {
    let changed = false
    for (const [key, record] of this.records) {
      if (record.pluginId !== target.pluginId || record.featureCode !== target.featureCode) continue
      if (record.cmdSignature !== target.cmdSignature && record.cmdId !== target.cmdId) continue
      this.records.delete(key)
      changed = true
    }
    return changed
  }

  private load(): void {
    if (!existsSync(this.storePath)) return
    try {
      const raw = readFileSync(this.storePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<DisabledCommandStoreFile> | DisabledCommandRecord[]
      const list = Array.isArray(parsed) ? parsed : parsed.disabledCommands || []
      for (const record of list) {
        if (!this.isValidRecord(record)) continue
        this.records.set(createTargetKey(record), {
          ...record,
          updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
        })
      }
    } catch {
      this.records.clear()
    }
  }

  private save(): void {
    const payload: DisabledCommandStoreFile = {
      disabledCommands: Array.from(this.records.values()).sort((a, b) => b.updatedAt - a.updatedAt)
    }
    writeFileSync(this.storePath, JSON.stringify(payload, null, 2))
  }

  private isValidRecord(record: unknown): record is DisabledCommandRecord {
    if (!record || typeof record !== 'object') return false
    const item = record as Partial<DisabledCommandRecord>
    return Boolean(item.pluginId && item.featureCode && item.cmdId && item.cmdSignature)
  }
}
