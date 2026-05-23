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
import {
  detectSystemReservedShortcut,
  type SystemReservedShortcutReason
} from '../services/system-reserved-shortcuts'
import {
  isKeyboardAcceleratorSupported,
  type InputHookService
} from '../services/input-hook'
import log from 'electron-log'

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

interface CommandShortcutInputHookLike {
  register: (
    id: string,
    accelerator: string,
    callback: () => void,
    options?: { consume?: boolean }
  ) => boolean
  unregister: (id: string) => void
  unregisterByPrefix?: (prefix: string) => void
}

interface PluginCommandShortcutManagerDependencies {
  app?: CommandShortcutAppLike
  globalShortcut?: CommandShortcutRegistrarLike
  inputHook?: CommandShortcutInputHookLike
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

const PLUGIN_COMMAND_HOOK_PREFIX = 'plugin-command:'

function formatSystemReservedShortcutError(reason: SystemReservedShortcutReason): string {
  switch (reason) {
    case 'win-meta':
      return '包含 Win 键的快捷键由系统保留'
    case 'win-alt-tab':
      return 'Alt+Tab 为 Windows 任务切换快捷键'
    case 'win-alt-escape':
      return 'Alt+Esc 为 Windows 窗口切换快捷键'
    case 'win-alt-f4':
      return 'Alt+F4 为 Windows 窗口关闭快捷键'
    case 'win-ctrl-escape':
      return 'Ctrl+Esc 为 Windows 开始菜单快捷键'
    default:
      return '该快捷键由系统保留'
  }
}

export class PluginCommandShortcutManager {
  private readonly options: PluginCommandShortcutManagerOptions
  private readonly app: CommandShortcutAppLike
  private readonly globalShortcut: CommandShortcutRegistrarLike
  private inputHook?: CommandShortcutInputHookLike
  private readonly storePath: string
  private bindings = new Map<string, PluginCommandShortcutBinding>()
  private state = new Map<string, CommandShortcutStateInfo>()
  private activeBindingAccelerators = new Map<string, string>()
  private activeAcceleratorOwners = new Map<string, string>()
  private activeBindingBackends = new Map<string, 'hook' | 'global'>()
  private initialized = false

  constructor(
    options: PluginCommandShortcutManagerOptions,
    dependencies: PluginCommandShortcutManagerDependencies = {}
  ) {
    this.options = options
    this.app = dependencies.app || electronApp
    this.globalShortcut = dependencies.globalShortcut || electronGlobalShortcut
    this.inputHook = dependencies.inputHook
    const configDir = this.app.getPath('userData')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.storePath = join(configDir, 'plugin-command-shortcuts.json')
    this.load()
  }

  initialize(): void {
    this.initialized = true
    this.reconcileRegistrations()
  }

  setInputHookService(inputHook: InputHookService): void {
    this.inputHook = inputHook
    if (this.initialized) {
      this.reconcileRegistrations()
    }
  }

  destroy(): void {
    this.unregisterAllActive()
    this.state.clear()
    this.initialized = false
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

    const reservedReason = detectSystemReservedShortcut(accelerator)
    if (reservedReason) {
      return {
        ok: false,
        state: 'system-reserved-shortcut',
        error: formatSystemReservedShortcutError(reservedReason)
      }
    }

    if (this.inputHook) {
      if (!isKeyboardAcceleratorSupported(accelerator)) {
        return { ok: false, state: 'invalid-shortcut', error: '快捷键格式无效' }
      }
      return { ok: true }
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

    const reservedReason = detectSystemReservedShortcut(binding.accelerator)
    if (reservedReason) {
      return {
        state: 'system-reserved-shortcut',
        error: formatSystemReservedShortcutError(reservedReason)
      }
    }

    if (this.inputHook) {
      return this.registerHookBinding(binding)
    }

    if (this.globalShortcut.isRegistered(binding.accelerator)) {
      return {
        state: 'shortcut-conflict',
        error: '该快捷键已被系统或应用占用'
      }
    }

    try {
      const success = this.globalShortcut.register(binding.accelerator, () => this.runBinding(binding))

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
    this.activeBindingBackends.set(binding.id, 'global')
    return { state: 'active' }
  }

  private registerHookBinding(binding: PluginCommandShortcutBinding): CommandShortcutStateInfo {
    if (!this.inputHook) {
      return {
        state: 'shortcut-conflict',
        error: '底层快捷键接管服务不可用'
      }
    }

    try {
      const success = this.inputHook.register(
        this.getHookId(binding.id),
        binding.accelerator,
        () => this.runBinding(binding),
        { consume: true }
      )
      if (!success) {
        return {
          state: 'invalid-shortcut',
          error: '快捷键格式无效或底层接管不可用'
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
    this.activeBindingBackends.set(binding.id, 'hook')
    return { state: 'active' }
  }

  private runBinding(binding: PluginCommandShortcutBinding): void {
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
          log.warn(
            `[CommandShortcut] Failed to run ${binding.pluginId}:${binding.featureCode} via "${binding.accelerator}"`,
            result.error
          )
        }
      })
      .catch((error) => {
        log.warn(
          `[CommandShortcut] Failed to run ${binding.pluginId}:${binding.featureCode} via "${binding.accelerator}"`,
          error
        )
      })
  }

  private unregisterBinding(bindingId: string): void {
    const accelerator = this.activeBindingAccelerators.get(bindingId)
    if (!accelerator) return
    const backend = this.activeBindingBackends.get(bindingId)
    if (backend === 'hook') {
      this.inputHook?.unregister(this.getHookId(bindingId))
    } else {
      this.globalShortcut.unregister(accelerator)
    }
    this.activeBindingAccelerators.delete(bindingId)
    this.activeAcceleratorOwners.delete(accelerator)
    this.activeBindingBackends.delete(bindingId)
  }

  private unregisterAllActive(): void {
    if (this.inputHook && Array.from(this.activeBindingBackends.values()).includes('hook')) {
      if (this.inputHook.unregisterByPrefix) {
        this.inputHook.unregisterByPrefix(PLUGIN_COMMAND_HOOK_PREFIX)
      } else {
        for (const bindingId of this.activeBindingBackends.keys()) {
          if (this.activeBindingBackends.get(bindingId) === 'hook') {
            this.inputHook.unregister(this.getHookId(bindingId))
          }
        }
      }
    }

    for (const [bindingId, accelerator] of this.activeBindingAccelerators) {
      if (this.activeBindingBackends.get(bindingId) === 'global') {
        this.globalShortcut.unregister(accelerator)
      }
    }
    this.activeBindingAccelerators.clear()
    this.activeAcceleratorOwners.clear()
    this.activeBindingBackends.clear()
  }

  private getHookId(bindingId: string): string {
    return `${PLUGIN_COMMAND_HOOK_PREFIX}${bindingId}`
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
