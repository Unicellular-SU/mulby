import { app as electronApp, globalShortcut as electronGlobalShortcut } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  InputPayload,
  Plugin,
  PluginCommandItem,
  PluginCommandShortcutBindInput,
  PluginCommandShortcutBindResult,
  PluginCommandShortcutBinding,
  PluginCommandShortcutBindingRecord,
  PluginCommandShortcutBindingState,
  PluginCommandShortcutValidationResult
} from '../../shared/types/plugin'

interface PluginCommandShortcutManagerOptions {
  listCommands: (pluginId?: string) => PluginCommandItem[]
  getPlugin: (pluginId: string) => Plugin | undefined
  runPluginCommand: (
    pluginId: string,
    featureCode: string,
    cmdId: string,
    cmdSignature: string,
    input?: string | InputPayload
  ) => Promise<{ success: boolean; hasUI?: boolean; error?: string }>
}

interface CommandShortcutAppLike {
  getPath: (name: 'userData') => string
}

interface CommandShortcutRegistrarLike {
  register: (accelerator: string, callback: () => void) => boolean
  unregister: (accelerator: string) => void
  isRegistered: (accelerator: string) => boolean
}

interface PluginCommandShortcutManagerDependencies {
  app?: CommandShortcutAppLike
  globalShortcut?: CommandShortcutRegistrarLike
}

interface CommandShortcutStoreFile {
  bindings: PluginCommandShortcutBinding[]
}

interface CommandResolveResult {
  command?: PluginCommandItem
  state?: PluginCommandShortcutBindingState
  error?: string
}

interface CommandShortcutStateInfo {
  state: PluginCommandShortcutBindingState
  error?: string
}

const EMPTY_PAYLOAD: InputPayload = {
  text: '',
  attachments: []
}

export class PluginCommandShortcutManager {
  private readonly options: PluginCommandShortcutManagerOptions
  private readonly app: CommandShortcutAppLike
  private readonly globalShortcut: CommandShortcutRegistrarLike
  private readonly storePath: string
  private bindings = new Map<string, PluginCommandShortcutBinding>()
  private state = new Map<string, CommandShortcutStateInfo>()
  private activeBindingAccelerators = new Map<string, string>()
  private activeAcceleratorOwners = new Map<string, string>()

  constructor(
    options: PluginCommandShortcutManagerOptions,
    dependencies: PluginCommandShortcutManagerDependencies = {}
  ) {
    this.options = options
    this.app = dependencies.app || electronApp
    this.globalShortcut = dependencies.globalShortcut || electronGlobalShortcut
    const configDir = this.app.getPath('userData')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.storePath = join(configDir, 'plugin-command-shortcuts.json')
    this.load()
  }

  initialize(): void {
    this.reconcileRegistrations()
  }

  destroy(): void {
    this.unregisterAllActive()
    this.state.clear()
  }

  listBindings(pluginId?: string): PluginCommandShortcutBindingRecord[] {
    this.reconcileRegistrations()
    const rows = Array.from(this.bindings.values())
      .filter((item) => !pluginId || item.pluginId === pluginId)
      .map((item) => this.toBindingRecord(item))
    rows.sort((a, b) => {
      const pluginCompare = (a.pluginDisplayName || a.pluginId).localeCompare(b.pluginDisplayName || b.pluginId)
      if (pluginCompare !== 0) return pluginCompare
      const featureCompare = (a.featureExplain || a.featureCode).localeCompare(b.featureExplain || b.featureCode)
      if (featureCompare !== 0) return featureCompare
      return a.commandLabel.localeCompare(b.commandLabel)
    })
    return rows
  }

  bind(input: PluginCommandShortcutBindInput): PluginCommandShortcutBindResult {
    const accelerator = input.accelerator.trim()
    if (!accelerator) {
      return {
        success: false,
        state: 'invalid-shortcut',
        error: '快捷键不能为空'
      }
    }

    const commandResult = this.resolveCommand(input.pluginId, input.featureCode, input.cmdId, input.cmdSignature)
    if (!commandResult.command) {
      return {
        success: false,
        state: commandResult.state,
        error: commandResult.error
      }
    }
    if (!commandResult.command.bindable) {
      return {
        success: false,
        state: 'command-not-bindable',
        error: '该指令类型暂不支持绑定快捷键'
      }
    }
    if (commandResult.command.disabled) {
      return {
        success: false,
        state: 'command-disabled',
        error: '指令已禁用'
      }
    }

    const existing = this.findBindingByTarget(input.pluginId, input.featureCode, input.cmdId)
    const preflight = this.preflightAccelerator(accelerator, existing?.id)
    if (!preflight.ok) {
      return {
        success: false,
        state: preflight.state,
        error: preflight.error
      }
    }

    const now = Date.now()
    const next: PluginCommandShortcutBinding = {
      id: existing?.id || this.generateBindingId(),
      pluginId: input.pluginId,
      featureCode: input.featureCode,
      cmdId: input.cmdId,
      cmdSignature: input.cmdSignature,
      commandLabel: input.commandLabel || commandResult.command.displayLabel,
      accelerator,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }

    this.bindings.set(next.id, next)
    this.save()
    this.reconcileRegistrations()

    const binding = this.toBindingRecord(next)
    if (binding.state !== 'active' && binding.state !== 'plugin-disabled') {
      return {
        success: false,
        state: binding.state,
        error: this.state.get(binding.id)?.error || '快捷键绑定失败',
        binding
      }
    }

    return {
      success: true,
      state: binding.state,
      binding
    }
  }

  unbind(bindingId: string): boolean {
    const binding = this.bindings.get(bindingId)
    if (!binding) return false

    this.unregisterBinding(bindingId)
    this.bindings.delete(bindingId)
    this.state.delete(bindingId)
    this.save()
    return true
  }

  validateAccelerator(
    accelerator: string,
    excludeBindingId?: string
  ): PluginCommandShortcutValidationResult {
    const result = this.preflightAccelerator(accelerator.trim(), excludeBindingId)
    if (result.ok) {
      return { ok: true }
    }
    return {
      ok: false,
      state: result.state,
      error: result.error
    }
  }

  removeByPlugin(pluginId: string): void {
    let changed = false
    for (const binding of Array.from(this.bindings.values())) {
      if (binding.pluginId !== pluginId) continue
      this.unregisterBinding(binding.id)
      this.bindings.delete(binding.id)
      this.state.delete(binding.id)
      changed = true
    }
    if (changed) {
      this.save()
    }
  }

  refresh(): void {
    this.reconcileRegistrations()
  }

  private toBindingRecord(binding: PluginCommandShortcutBinding): PluginCommandShortcutBindingRecord {
    const commandResult = this.resolveCommand(binding.pluginId, binding.featureCode, binding.cmdId, binding.cmdSignature)
    const plugin = this.options.getPlugin(binding.pluginId)
    const stateInfo = this.state.get(binding.id)
    return {
      ...binding,
      state: stateInfo?.state || commandResult.state || 'command-missing',
      pluginDisplayName: plugin?.manifest.displayName,
      featureExplain: commandResult.command?.featureExplain,
      cmdType: commandResult.command?.cmdType
    }
  }

  private findBindingByTarget(
    pluginId: string,
    featureCode: string,
    cmdId: string
  ): PluginCommandShortcutBinding | undefined {
    return Array.from(this.bindings.values()).find(
      (binding) =>
        binding.pluginId === pluginId &&
        binding.featureCode === featureCode &&
        binding.cmdId === cmdId
    )
  }

  private resolveCommand(
    pluginId: string,
    featureCode: string,
    cmdId: string,
    cmdSignature: string
  ): CommandResolveResult {
    const plugin = this.options.getPlugin(pluginId)
    if (!plugin) {
      return { state: 'plugin-missing', error: '插件不存在' }
    }

    const commands = this.options.listCommands(pluginId)
    const featureCommands = commands.filter((item) => item.featureCode === featureCode)
    if (featureCommands.length === 0) {
      return { state: 'feature-missing', error: '功能入口不存在' }
    }

    const exact = featureCommands.find((item) => item.cmdId === cmdId && item.cmdSignature === cmdSignature)
    if (exact) {
      return { command: exact }
    }
    const bySignature = featureCommands.find((item) => item.cmdSignature === cmdSignature)
    if (bySignature) {
      return { command: bySignature }
    }
    const byId = featureCommands.find((item) => item.cmdId === cmdId)
    if (byId) {
      return { command: byId }
    }
    return { state: 'command-missing', error: '指令不存在' }
  }

  private preflightAccelerator(
    accelerator: string,
    excludeBindingId?: string
  ): { ok: true } | { ok: false; state: PluginCommandShortcutBindingState; error: string } {
    if (!accelerator) {
      return { ok: false, state: 'invalid-shortcut', error: '快捷键不能为空' }
    }

    const duplicate = Array.from(this.bindings.values()).find(
      (binding) => binding.id !== excludeBindingId && binding.accelerator === accelerator
    )
    if (duplicate) {
      return { ok: false, state: 'shortcut-conflict', error: '该快捷键已绑定给其他指令' }
    }

    const ownerId = this.activeAcceleratorOwners.get(accelerator)
    if (ownerId && ownerId !== excludeBindingId) {
      return { ok: false, state: 'shortcut-conflict', error: '该快捷键正在被其他指令占用' }
    }

    if (this.globalShortcut.isRegistered(accelerator) && ownerId !== excludeBindingId) {
      return { ok: false, state: 'shortcut-conflict', error: '该快捷键已被系统或应用占用' }
    }

    if (excludeBindingId && ownerId === excludeBindingId) {
      return { ok: true }
    }

    try {
      const ok = this.globalShortcut.register(accelerator, () => {})
      if (!ok) {
        return { ok: false, state: 'shortcut-conflict', error: '该快捷键已被系统或应用占用' }
      }
      this.globalShortcut.unregister(accelerator)
      return { ok: true }
    } catch {
      return { ok: false, state: 'invalid-shortcut', error: '快捷键格式无效' }
    }
  }

  private reconcileRegistrations(): void {
    this.unregisterAllActive()
    this.state.clear()

    const bindings = Array.from(this.bindings.values()).sort((a, b) => a.createdAt - b.createdAt)
    for (const binding of bindings) {
      const commandResult = this.resolveCommand(
        binding.pluginId,
        binding.featureCode,
        binding.cmdId,
        binding.cmdSignature
      )
      if (!commandResult.command) {
        this.state.set(binding.id, {
          state: commandResult.state || 'command-missing',
          error: commandResult.error
        })
        continue
      }

      if (!commandResult.command.bindable) {
        this.state.set(binding.id, {
          state: 'command-not-bindable',
          error: '该指令类型暂不支持绑定快捷键'
        })
        continue
      }
      if (commandResult.command.disabled) {
        this.state.set(binding.id, {
          state: 'command-disabled',
          error: '指令已禁用'
        })
        continue
      }

      const plugin = this.options.getPlugin(binding.pluginId)
      if (!plugin || !plugin.enabled) {
        this.state.set(binding.id, {
          state: plugin ? 'plugin-disabled' : 'plugin-missing'
        })
        continue
      }

      const registerResult = this.registerBinding(binding)
      this.state.set(binding.id, registerResult)
    }
  }

  private registerBinding(binding: PluginCommandShortcutBinding): CommandShortcutStateInfo {
    if (this.activeAcceleratorOwners.has(binding.accelerator)) {
      return {
        state: 'shortcut-conflict',
        error: '该快捷键正在被其他指令占用'
      }
    }
    if (this.globalShortcut.isRegistered(binding.accelerator)) {
      return {
        state: 'shortcut-conflict',
        error: '该快捷键已被系统或应用占用'
      }
    }

    try {
      const success = this.globalShortcut.register(binding.accelerator, () => {
        void this.options
          .runPluginCommand(
            binding.pluginId,
            binding.featureCode,
            binding.cmdId,
            binding.cmdSignature,
            EMPTY_PAYLOAD
          )
          .then((result) => {
            if (!result.success) {
              console.warn(
                `[CommandShortcut] Failed to run ${binding.pluginId}:${binding.featureCode} via "${binding.accelerator}"`,
                result.error
              )
            }
          })
          .catch((error) => {
            console.warn(
              `[CommandShortcut] Failed to run ${binding.pluginId}:${binding.featureCode} via "${binding.accelerator}"`,
              error
            )
          })
      })

      if (!success) {
        return {
          state: 'shortcut-conflict',
          error: '该快捷键已被系统或应用占用'
        }
      }
    } catch {
      return {
        state: 'invalid-shortcut',
        error: '快捷键格式无效'
      }
    }

    this.activeBindingAccelerators.set(binding.id, binding.accelerator)
    this.activeAcceleratorOwners.set(binding.accelerator, binding.id)
    return { state: 'active' }
  }

  private unregisterBinding(bindingId: string): void {
    const accelerator = this.activeBindingAccelerators.get(bindingId)
    if (!accelerator) return
    this.globalShortcut.unregister(accelerator)
    this.activeBindingAccelerators.delete(bindingId)
    this.activeAcceleratorOwners.delete(accelerator)
  }

  private unregisterAllActive(): void {
    for (const accelerator of this.activeBindingAccelerators.values()) {
      this.globalShortcut.unregister(accelerator)
    }
    this.activeBindingAccelerators.clear()
    this.activeAcceleratorOwners.clear()
  }

  private generateBindingId(): string {
    return `cmd-shortcut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }

  private load(): void {
    if (!existsSync(this.storePath)) return
    try {
      const raw = readFileSync(this.storePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<CommandShortcutStoreFile> | PluginCommandShortcutBinding[]
      const list = Array.isArray(parsed) ? parsed : parsed.bindings || []
      for (const item of list) {
        if (!this.isValidBinding(item)) continue
        this.bindings.set(item.id, {
          ...item,
          accelerator: item.accelerator.trim()
        })
      }
    } catch {
      this.bindings.clear()
    }
  }

  private save(): void {
    const payload: CommandShortcutStoreFile = {
      bindings: Array.from(this.bindings.values()).sort((a, b) => a.createdAt - b.createdAt)
    }
    writeFileSync(this.storePath, JSON.stringify(payload, null, 2))
  }

  private isValidBinding(item: unknown): item is PluginCommandShortcutBinding {
    if (!item || typeof item !== 'object') return false
    const candidate = item as Partial<PluginCommandShortcutBinding>
    return Boolean(
      candidate.id &&
      candidate.pluginId &&
      candidate.featureCode &&
      candidate.cmdId &&
      candidate.cmdSignature &&
      candidate.commandLabel &&
      candidate.accelerator &&
      typeof candidate.createdAt === 'number' &&
      typeof candidate.updatedAt === 'number'
    )
  }
}
