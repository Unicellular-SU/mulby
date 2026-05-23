import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import log from 'electron-log'
import { PluginCommandShortcutManager } from '../../plugin/command-shortcuts'
import type {
  InputPayload,
  Plugin,
  PluginCommandItem,
  PluginCommandShortcutBindInput,
  PluginCommandShortcutBinding
} from '../../../shared/types/plugin'

class MockGlobalShortcut {
  private readonly callbacks = new Map<string, () => void>()
  readonly registerCalls: string[] = []
  readonly unregisterCalls: string[] = []
  readonly reserved = new Set<string>()
  readonly failOnRegister = new Set<string>()
  readonly throwOnRegister = new Set<string>()

  isRegistered(accelerator: string): boolean {
    return this.reserved.has(accelerator) || this.callbacks.has(accelerator)
  }

  register(accelerator: string, callback: () => void): boolean {
    this.registerCalls.push(accelerator)
    if (this.throwOnRegister.has(accelerator)) {
      throw new Error('invalid accelerator')
    }
    if (this.failOnRegister.has(accelerator) || this.reserved.has(accelerator)) {
      return false
    }
    this.callbacks.set(accelerator, callback)
    return true
  }

  unregister(accelerator: string): void {
    this.unregisterCalls.push(accelerator)
    this.callbacks.delete(accelerator)
  }

  trigger(accelerator: string): void {
    this.callbacks.get(accelerator)?.()
  }

  hasActive(accelerator: string): boolean {
    return this.callbacks.has(accelerator)
  }
}

class MockInputHook {
  readonly registerCalls: Array<{ id: string; accelerator: string; consume?: boolean }> = []
  readonly unregisterCalls: string[] = []
  private readonly callbacks = new Map<string, () => void>()

  register(id: string, accelerator: string, callback: () => void, options?: { consume?: boolean }): boolean {
    this.registerCalls.push({ id, accelerator, consume: options?.consume })
    this.callbacks.set(id, callback)
    return true
  }

  unregister(id: string): void {
    this.unregisterCalls.push(id)
    this.callbacks.delete(id)
  }

  unregisterByPrefix(prefix: string): void {
    for (const id of Array.from(this.callbacks.keys())) {
      if (id.startsWith(prefix)) this.unregister(id)
    }
  }

  trigger(id: string): void {
    this.callbacks.get(id)?.()
  }
}

function createPlugin(id: string, enabled = true, displayName = id): Plugin {
  return {
    id,
    enabled,
    path: `/tmp/${id}`,
    manifest: {
      name: id,
      version: '1.0.0',
      displayName,
      description: 'test plugin',
      main: 'index.js',
      features: []
    }
  }
}

function createCommand(input: Partial<PluginCommandItem> = {}): PluginCommandItem {
  return {
    pluginId: input.pluginId || 'plugin.alpha',
    pluginName: input.pluginName || (input.pluginId || 'plugin.alpha'),
    pluginDisplayName: input.pluginDisplayName || 'Plugin Alpha',
    featureCode: input.featureCode || 'feature.main',
    featureExplain: input.featureExplain || 'Main Feature',
    cmdId: input.cmdId || 'cmd-main',
    cmdType: input.cmdType || 'keyword',
    cmdSignature: input.cmdSignature || 'keyword|main',
    commandKind: input.commandKind || 'launch',
    displayLabel: input.displayLabel || 'main',
    explain: input.explain,
    bindable: input.bindable ?? true,
    disabled: input.disabled ?? false
  }
}

function createBinding(input: {
  id: string
  pluginId: string
  featureCode: string
  cmdId: string
  cmdSignature: string
  commandLabel: string
  accelerator: string
  createdAt: number
  updatedAt?: number
}): PluginCommandShortcutBinding {
  return {
    ...input,
    updatedAt: input.updatedAt ?? input.createdAt
  }
}

function toBindInput(command: PluginCommandItem, accelerator: string): PluginCommandShortcutBindInput {
  return {
    pluginId: command.pluginId,
    featureCode: command.featureCode,
    cmdId: command.cmdId,
    cmdSignature: command.cmdSignature,
    commandLabel: command.displayLabel,
    accelerator
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('plugin command shortcut manager', () => {
  it('binds, updates, and triggers plugin command shortcuts', async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-cmd-shortcuts-'))
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const shortcuts = new MockGlobalShortcut()
    const plugins = new Map<string, Plugin>([
      ['plugin.alpha', createPlugin('plugin.alpha', true, 'Alpha')]
    ])
    const command = createCommand({
      pluginId: 'plugin.alpha',
      pluginName: 'plugin.alpha',
      pluginDisplayName: 'Alpha',
      featureCode: 'feature.open',
      featureExplain: 'Open',
      cmdId: 'cmd-open',
      cmdSignature: 'keyword|open',
      displayLabel: 'open'
    })
    let commands: PluginCommandItem[] = [command]
    const runCalls: Array<{ pluginId: string; featureCode: string; input?: string | InputPayload }> = []

    const manager = new PluginCommandShortcutManager(
      {
        listCommands: (pluginId?: string) => commands.filter((item) => !pluginId || item.pluginId === pluginId),
        getPlugin: (pluginId: string) => plugins.get(pluginId),
        runPluginCommand: async (pluginId, featureCode, _cmdId, _cmdSignature, input) => {
          runCalls.push({ pluginId, featureCode, input })
          return { success: true }
        }
      },
      {
        app: { getPath: () => tempDir },
        globalShortcut: shortcuts
      }
    )

    const first = manager.bind(toBindInput(command, '  CommandOrControl+Shift+K  '))
    assert.equal(first.success, true)
    assert.equal(first.state, 'active')
    assert.equal(first.binding?.accelerator, 'CommandOrControl+Shift+K')
    assert.ok(first.binding?.id)

    shortcuts.trigger('CommandOrControl+Shift+K')
    await flushMicrotasks()
    assert.equal(runCalls.length, 1)
    assert.deepEqual(runCalls[0], {
      pluginId: 'plugin.alpha',
      featureCode: 'feature.open',
      input: { text: '', attachments: [] }
    })

    const second = manager.bind(toBindInput(command, 'CommandOrControl+Shift+K'))
    assert.equal(second.success, true)
    assert.equal(second.binding?.id, first.binding?.id)
    assert.equal(manager.listBindings().length, 1)

    const functionKey = manager.bind(toBindInput(command, 'F1'))
    assert.equal(functionKey.success, true)
    assert.equal(functionKey.state, 'active')
    assert.equal(functionKey.binding?.accelerator, 'F1')
    assert.equal(shortcuts.hasActive('F1'), true)

    commands = [command]
  })

  it('reports duplicate/system/invalid accelerator conflicts', async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-cmd-shortcuts-'))
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const shortcuts = new MockGlobalShortcut()
    const plugins = new Map<string, Plugin>([
      ['plugin.alpha', createPlugin('plugin.alpha', true, 'Alpha')]
    ])
    const commandA = createCommand({
      pluginId: 'plugin.alpha',
      pluginName: 'plugin.alpha',
      pluginDisplayName: 'Alpha',
      featureCode: 'feature.a',
      featureExplain: 'Feature A',
      cmdId: 'cmd-a',
      cmdSignature: 'keyword|a',
      displayLabel: 'a'
    })
    const commandB = createCommand({
      pluginId: 'plugin.alpha',
      pluginName: 'plugin.alpha',
      pluginDisplayName: 'Alpha',
      featureCode: 'feature.b',
      featureExplain: 'Feature B',
      cmdId: 'cmd-b',
      cmdSignature: 'keyword|b',
      displayLabel: 'b'
    })
    const commands = [commandA, commandB]

    const manager = new PluginCommandShortcutManager(
      {
        listCommands: (pluginId?: string) => commands.filter((item) => !pluginId || item.pluginId === pluginId),
        getPlugin: (pluginId: string) => plugins.get(pluginId),
        runPluginCommand: async () => ({ success: true })
      },
      {
        app: { getPath: () => tempDir },
        globalShortcut: shortcuts
      }
    )

    const first = manager.bind(toBindInput(commandA, 'CommandOrControl+1'))
    assert.equal(first.success, true)

    const duplicate = manager.bind(toBindInput(commandB, 'CommandOrControl+1'))
    assert.equal(duplicate.success, false)
    assert.equal(duplicate.state, 'shortcut-conflict')
    assert.match(duplicate.error || '', /已绑定给其他指令/)

    shortcuts.reserved.add('CommandOrControl+2')
    const occupied = manager.validateAccelerator('CommandOrControl+2')
    assert.equal(occupied.ok, false)
    assert.equal(occupied.state, 'shortcut-conflict')

    shortcuts.throwOnRegister.add('CommandOrControl+3')
    const invalid = manager.validateAccelerator('CommandOrControl+3')
    assert.equal(invalid.ok, false)
    assert.equal(invalid.state, 'invalid-shortcut')

    shortcuts.failOnRegister.add('CommandOrControl+4')
    const rejectedByRegister = manager.validateAccelerator('CommandOrControl+4')
    assert.equal(rejectedByRegister.ok, false)
    assert.equal(rejectedByRegister.state, 'shortcut-conflict')

    const empty = manager.bind(toBindInput(commandB, '   '))
    assert.equal(empty.success, false)
    assert.equal(empty.state, 'invalid-shortcut')
  })

  it('binds plugin command shortcuts through InputHookService despite external occupation', async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-cmd-shortcuts-'))
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const shortcuts = new MockGlobalShortcut()
    shortcuts.failOnRegister.add('Alt+Space')
    const inputHook = new MockInputHook()
    const plugins = new Map<string, Plugin>([
      ['plugin.alpha', createPlugin('plugin.alpha', true, 'Alpha')]
    ])
    const command = createCommand({
      pluginId: 'plugin.alpha',
      pluginName: 'plugin.alpha',
      pluginDisplayName: 'Alpha',
      featureCode: 'feature.hook',
      featureExplain: 'Hook',
      cmdId: 'cmd-hook',
      cmdSignature: 'keyword|hook',
      displayLabel: 'hook'
    })
    const runCalls: Array<{ pluginId: string; featureCode: string }> = []

    const manager = new PluginCommandShortcutManager(
      {
        listCommands: () => [command],
        getPlugin: (pluginId: string) => plugins.get(pluginId),
        runPluginCommand: async (pluginId, featureCode) => {
          runCalls.push({ pluginId, featureCode })
          return { success: true }
        }
      },
      {
        app: { getPath: () => tempDir },
        globalShortcut: shortcuts,
        inputHook
      } as never
    )

    const bound = manager.bind(toBindInput(command, 'Alt+Space'))
    assert.equal(bound.success, true)
    assert.equal(bound.state, 'active')
    assert.equal(inputHook.registerCalls.length, 1)
    assert.equal(inputHook.registerCalls[0].accelerator, 'Alt+Space')
    assert.equal(inputHook.registerCalls[0].consume, true)
    assert.equal(shortcuts.registerCalls.includes('Alt+Space'), false)

    inputHook.trigger(inputHook.registerCalls[0].id)
    await flushMicrotasks()
    assert.deepEqual(runCalls, [{ pluginId: 'plugin.alpha', featureCode: 'feature.hook' }])

    assert.equal(manager.unbind(bound.binding!.id), true)
    assert.deepEqual(inputHook.unregisterCalls, [inputHook.registerCalls[0].id])
  })

  it('returns expected bind states for missing, non-bindable, disabled, and missing-command cases', async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-cmd-shortcuts-'))
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const shortcuts = new MockGlobalShortcut()
    const plugins = new Map<string, Plugin>([
      ['plugin.active', createPlugin('plugin.active', true, 'Active')],
      ['plugin.disabled', createPlugin('plugin.disabled', false, 'Disabled')]
    ])
    const launchCommand = createCommand({
      pluginId: 'plugin.active',
      pluginName: 'plugin.active',
      pluginDisplayName: 'Active',
      featureCode: 'feature.launch',
      featureExplain: 'Launch',
      cmdId: 'launch-id',
      cmdSignature: 'keyword|launch',
      displayLabel: 'launch'
    })
    const matchCommand = createCommand({
      pluginId: 'plugin.active',
      pluginName: 'plugin.active',
      pluginDisplayName: 'Active',
      featureCode: 'feature.match',
      featureExplain: 'Match',
      cmdId: 'match-id',
      cmdSignature: 'regex|match',
      cmdType: 'regex',
      commandKind: 'match',
      displayLabel: 'match',
      bindable: false
    })
    const disabledCommand = createCommand({
      pluginId: 'plugin.disabled',
      pluginName: 'plugin.disabled',
      pluginDisplayName: 'Disabled',
      featureCode: 'feature.disabled',
      featureExplain: 'Disabled',
      cmdId: 'disabled-id',
      cmdSignature: 'keyword|disabled',
      displayLabel: 'disabled'
    })
    const disabledByCommandState = createCommand({
      pluginId: 'plugin.active',
      pluginName: 'plugin.active',
      pluginDisplayName: 'Active',
      featureCode: 'feature.launch',
      featureExplain: 'Launch',
      cmdId: 'disabled-by-command',
      cmdSignature: 'keyword|disabled-by-command',
      displayLabel: 'disabled-by-command',
      disabled: true
    })
    const commands = [launchCommand, matchCommand, disabledCommand, disabledByCommandState]

    const manager = new PluginCommandShortcutManager(
      {
        listCommands: (pluginId?: string) => commands.filter((item) => !pluginId || item.pluginId === pluginId),
        getPlugin: (pluginId: string) => plugins.get(pluginId),
        runPluginCommand: async () => ({ success: true })
      },
      {
        app: { getPath: () => tempDir },
        globalShortcut: shortcuts
      }
    )

    const nonBindable = manager.bind(toBindInput(matchCommand, 'CommandOrControl+Alt+M'))
    assert.equal(nonBindable.success, false)
    assert.equal(nonBindable.state, 'command-not-bindable')

    const missingPlugin = manager.bind({
      pluginId: 'plugin.missing',
      featureCode: 'feature.none',
      cmdId: 'missing',
      cmdSignature: 'keyword|missing',
      commandLabel: 'missing',
      accelerator: 'CommandOrControl+Alt+P'
    })
    assert.equal(missingPlugin.success, false)
    assert.equal(missingPlugin.state, 'plugin-missing')

    const featureMissing = manager.bind({
      pluginId: 'plugin.active',
      featureCode: 'feature.none',
      cmdId: 'none',
      cmdSignature: 'keyword|none',
      commandLabel: 'none',
      accelerator: 'CommandOrControl+Alt+F'
    })
    assert.equal(featureMissing.success, false)
    assert.equal(featureMissing.state, 'feature-missing')

    const commandMissing = manager.bind({
      pluginId: 'plugin.active',
      featureCode: 'feature.launch',
      cmdId: 'not-exists',
      cmdSignature: 'keyword|not-exists',
      commandLabel: 'missing-command',
      accelerator: 'CommandOrControl+Alt+C'
    })
    assert.equal(commandMissing.success, false)
    assert.equal(commandMissing.state, 'command-missing')

    const commandDisabled = manager.bind(toBindInput(disabledByCommandState, 'CommandOrControl+Alt+X'))
    assert.equal(commandDisabled.success, false)
    assert.equal(commandDisabled.state, 'command-disabled')

    const disabled = manager.bind(toBindInput(disabledCommand, 'CommandOrControl+Alt+D'))
    assert.equal(disabled.success, true)
    assert.equal(disabled.state, 'plugin-disabled')
  })

  it('reconciles persisted bindings into expected runtime states', async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-cmd-shortcuts-'))
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const shortcuts = new MockGlobalShortcut()
    shortcuts.reserved.add('CommandOrControl+Alt+7')
    shortcuts.throwOnRegister.add('CommandOrControl+Alt+8')
    shortcuts.failOnRegister.add('CommandOrControl+Alt+10')

    const plugins = new Map<string, Plugin>([
      ['plugin.active', createPlugin('plugin.active', true, 'Active')],
      ['plugin.disabled', createPlugin('plugin.disabled', false, 'Disabled')],
      ['plugin.match', createPlugin('plugin.match', true, 'Match')],
      ['plugin.featureless', createPlugin('plugin.featureless', true, 'Featureless')],
      ['plugin.commandless', createPlugin('plugin.commandless', true, 'Commandless')]
    ])

    const commands: PluginCommandItem[] = [
      createCommand({
        pluginId: 'plugin.active',
        pluginName: 'plugin.active',
        pluginDisplayName: 'Active',
        featureCode: 'feature.active',
        featureExplain: 'Active Feature',
        cmdId: 'active-1',
        cmdSignature: 'keyword|active-1',
        displayLabel: 'active-1'
      }),
      createCommand({
        pluginId: 'plugin.active',
        pluginName: 'plugin.active',
        pluginDisplayName: 'Active',
        featureCode: 'feature.active',
        featureExplain: 'Active Feature',
        cmdId: 'active-2',
        cmdSignature: 'keyword|active-2',
        displayLabel: 'active-2'
      }),
      createCommand({
        pluginId: 'plugin.disabled',
        pluginName: 'plugin.disabled',
        pluginDisplayName: 'Disabled',
        featureCode: 'feature.disabled',
        featureExplain: 'Disabled Feature',
        cmdId: 'disabled-1',
        cmdSignature: 'keyword|disabled-1',
        displayLabel: 'disabled-1'
      }),
      createCommand({
        pluginId: 'plugin.match',
        pluginName: 'plugin.match',
        pluginDisplayName: 'Match',
        featureCode: 'feature.match',
        featureExplain: 'Match Feature',
        cmdId: 'match-1',
        cmdSignature: 'regex|match',
        cmdType: 'regex',
        commandKind: 'match',
        displayLabel: 'match-1',
        bindable: false
      }),
      createCommand({
        pluginId: 'plugin.commandless',
        pluginName: 'plugin.commandless',
        pluginDisplayName: 'Commandless',
        featureCode: 'feature.cmd',
        featureExplain: 'Commandless Feature',
        cmdId: 'existing-id',
        cmdSignature: 'keyword|existing',
        displayLabel: 'existing'
      })
    ]

    const bindings = [
      createBinding({
        id: 'b-active',
        pluginId: 'plugin.active',
        featureCode: 'feature.active',
        cmdId: 'active-1',
        cmdSignature: 'keyword|active-1',
        commandLabel: 'Active 1',
        accelerator: 'CommandOrControl+Alt+1',
        createdAt: 1
      }),
      createBinding({
        id: 'b-duplicate-owner',
        pluginId: 'plugin.active',
        featureCode: 'feature.active',
        cmdId: 'active-2',
        cmdSignature: 'keyword|active-2',
        commandLabel: 'Active 2 Duplicate',
        accelerator: 'CommandOrControl+Alt+1',
        createdAt: 2
      }),
      createBinding({
        id: 'b-disabled',
        pluginId: 'plugin.disabled',
        featureCode: 'feature.disabled',
        cmdId: 'disabled-1',
        cmdSignature: 'keyword|disabled-1',
        commandLabel: 'Disabled',
        accelerator: 'CommandOrControl+Alt+2',
        createdAt: 3
      }),
      createBinding({
        id: 'b-plugin-missing',
        pluginId: 'plugin.missing',
        featureCode: 'feature.none',
        cmdId: 'missing',
        cmdSignature: 'keyword|missing',
        commandLabel: 'Missing Plugin',
        accelerator: 'CommandOrControl+Alt+3',
        createdAt: 4
      }),
      createBinding({
        id: 'b-feature-missing',
        pluginId: 'plugin.featureless',
        featureCode: 'feature.none',
        cmdId: 'none',
        cmdSignature: 'keyword|none',
        commandLabel: 'Feature Missing',
        accelerator: 'CommandOrControl+Alt+4',
        createdAt: 5
      }),
      createBinding({
        id: 'b-command-missing',
        pluginId: 'plugin.commandless',
        featureCode: 'feature.cmd',
        cmdId: 'not-exist',
        cmdSignature: 'keyword|not-exist',
        commandLabel: 'Command Missing',
        accelerator: 'CommandOrControl+Alt+5',
        createdAt: 6
      }),
      createBinding({
        id: 'b-non-bindable',
        pluginId: 'plugin.match',
        featureCode: 'feature.match',
        cmdId: 'match-1',
        cmdSignature: 'regex|match',
        commandLabel: 'Match Command',
        accelerator: 'CommandOrControl+Alt+6',
        createdAt: 7
      }),
      createBinding({
        id: 'b-system-conflict',
        pluginId: 'plugin.active',
        featureCode: 'feature.active',
        cmdId: 'active-2',
        cmdSignature: 'keyword|active-2',
        commandLabel: 'System Conflict',
        accelerator: 'CommandOrControl+Alt+7',
        createdAt: 8
      }),
      createBinding({
        id: 'b-invalid-shortcut',
        pluginId: 'plugin.active',
        featureCode: 'feature.active',
        cmdId: 'active-2',
        cmdSignature: 'keyword|active-2',
        commandLabel: 'Invalid Shortcut',
        accelerator: 'CommandOrControl+Alt+8',
        createdAt: 9
      }),
      createBinding({
        id: 'b-register-false',
        pluginId: 'plugin.active',
        featureCode: 'feature.active',
        cmdId: 'active-2',
        cmdSignature: 'keyword|active-2',
        commandLabel: 'Register False',
        accelerator: 'CommandOrControl+Alt+10',
        createdAt: 10
      })
    ]

    await writeFile(
      path.join(tempDir, 'plugin-command-shortcuts.json'),
      JSON.stringify({
        bindings: [...bindings, { id: 'invalid-only-id' }]
      })
    )

    const manager = new PluginCommandShortcutManager(
      {
        listCommands: (pluginId?: string) => commands.filter((item) => !pluginId || item.pluginId === pluginId),
        getPlugin: (pluginId: string) => plugins.get(pluginId),
        runPluginCommand: async () => ({ success: true })
      },
      {
        app: { getPath: () => tempDir },
        globalShortcut: shortcuts
      }
    )

    manager.initialize()
    const rows = manager.listBindings()
    assert.equal(rows.length, bindings.length)
    const stateById = new Map(rows.map((item) => [item.id, item.state]))

    assert.equal(stateById.get('b-active'), 'active')
    assert.equal(stateById.get('b-duplicate-owner'), 'shortcut-conflict')
    assert.equal(stateById.get('b-disabled'), 'plugin-disabled')
    assert.equal(stateById.get('b-plugin-missing'), 'plugin-missing')
    assert.equal(stateById.get('b-feature-missing'), 'feature-missing')
    assert.equal(stateById.get('b-command-missing'), 'command-missing')
    assert.equal(stateById.get('b-non-bindable'), 'command-not-bindable')
    assert.equal(stateById.get('b-system-conflict'), 'shortcut-conflict')
    assert.equal(stateById.get('b-invalid-shortcut'), 'invalid-shortcut')
    assert.equal(stateById.get('b-register-false'), 'shortcut-conflict')

    assert.equal(shortcuts.hasActive('CommandOrControl+Alt+1'), true)
    assert.equal(shortcuts.hasActive('CommandOrControl+Alt+7'), false)
    assert.equal(shortcuts.hasActive('CommandOrControl+Alt+8'), false)

    const activeRows = manager.listBindings('plugin.active')
    assert.equal(activeRows.length, 5)
  })

  it('supports loading array stores and resolving by signature/id fallback', async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-cmd-shortcuts-'))
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const shortcuts = new MockGlobalShortcut()
    const plugin = createPlugin('plugin.alpha', true, 'Alpha')
    const plugins = new Map<string, Plugin>([['plugin.alpha', plugin]])
    let commands: PluginCommandItem[] = [
      createCommand({
        pluginId: 'plugin.alpha',
        pluginName: 'plugin.alpha',
        pluginDisplayName: 'Alpha',
        featureCode: 'feature.fallback',
        featureExplain: 'Fallback',
        cmdId: 'new-id',
        cmdSignature: 'keyword|legacy',
        displayLabel: 'fallback'
      })
    ]

    const binding = createBinding({
      id: 'b-fallback',
      pluginId: 'plugin.alpha',
      featureCode: 'feature.fallback',
      cmdId: 'legacy-id',
      cmdSignature: 'keyword|legacy',
      commandLabel: 'Legacy',
      accelerator: 'CommandOrControl+Alt+9',
      createdAt: 1
    })

    await writeFile(path.join(tempDir, 'plugin-command-shortcuts.json'), JSON.stringify([binding]))

    const manager = new PluginCommandShortcutManager(
      {
        listCommands: (pluginId?: string) => commands.filter((item) => !pluginId || item.pluginId === pluginId),
        getPlugin: (pluginId: string) => plugins.get(pluginId),
        runPluginCommand: async () => ({ success: true })
      },
      {
        app: { getPath: () => tempDir },
        globalShortcut: shortcuts
      }
    )

    manager.initialize()
    assert.equal(manager.listBindings()[0]?.state, 'active')

    commands = [
      createCommand({
        pluginId: 'plugin.alpha',
        pluginName: 'plugin.alpha',
        pluginDisplayName: 'Alpha',
        featureCode: 'feature.fallback',
        featureExplain: 'Fallback',
        cmdId: 'legacy-id',
        cmdSignature: 'keyword|new',
        displayLabel: 'fallback-id'
      })
    ]
    manager.refresh()
    assert.equal(manager.listBindings()[0]?.state, 'active')
  })

  it('logs warnings when shortcut-triggered run fails or rejects', async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-cmd-shortcuts-'))
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const shortcuts = new MockGlobalShortcut()
    const plugins = new Map<string, Plugin>([
      ['plugin.alpha', createPlugin('plugin.alpha', true, 'Alpha')]
    ])
    const command = createCommand({
      pluginId: 'plugin.alpha',
      pluginName: 'plugin.alpha',
      pluginDisplayName: 'Alpha',
      featureCode: 'feature.warn',
      featureExplain: 'Warn',
      cmdId: 'warn',
      cmdSignature: 'keyword|warn',
      displayLabel: 'warn'
    })
    let mode: 'fail' | 'reject' = 'fail'

    const originalWarn = log.warn
    const warnings: unknown[][] = []
    log.warn = (...args: unknown[]) => {
      warnings.push(args)
    }
    t.after(() => {
      log.warn = originalWarn
    })

    const manager = new PluginCommandShortcutManager(
      {
        listCommands: () => [command],
        getPlugin: () => plugins.get('plugin.alpha'),
        runPluginCommand: async () => {
          if (mode === 'fail') {
            return { success: false, error: 'run failed' }
          }
          throw new Error('run crashed')
        }
      },
      {
        app: { getPath: () => tempDir },
        globalShortcut: shortcuts
      }
    )

    const bound = manager.bind(toBindInput(command, 'CommandOrControl+Shift+W'))
    assert.equal(bound.success, true)

    shortcuts.trigger('CommandOrControl+Shift+W')
    await flushMicrotasks()

    mode = 'reject'
    shortcuts.trigger('CommandOrControl+Shift+W')
    await flushMicrotasks()

    assert.equal(warnings.length, 2)
    assert.match(String(warnings[0][0]), /Failed to run/)
    assert.match(String(warnings[1][0]), /Failed to run/)
  })

  it('returns bind failure when preflight passes but runtime registration fails', async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-cmd-shortcuts-'))
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    let registerCount = 0
    const stagedShortcut = {
      isRegistered: (_accelerator: string) => false,
      register: (_accelerator: string, _callback: () => void) => {
        registerCount += 1
        return registerCount === 1
      },
      unregister: (_accelerator: string) => {}
    }

    const plugins = new Map<string, Plugin>([
      ['plugin.alpha', createPlugin('plugin.alpha', true, 'Alpha')]
    ])
    const command = createCommand({
      pluginId: 'plugin.alpha',
      pluginName: 'plugin.alpha',
      pluginDisplayName: 'Alpha',
      featureCode: 'feature.fail',
      featureExplain: 'Fail',
      cmdId: 'fail-id',
      cmdSignature: 'keyword|fail',
      displayLabel: 'fail'
    })

    const manager = new PluginCommandShortcutManager(
      {
        listCommands: () => [command],
        getPlugin: () => plugins.get('plugin.alpha'),
        runPluginCommand: async () => ({ success: true })
      },
      {
        app: { getPath: () => tempDir },
        globalShortcut: stagedShortcut
      }
    )

    const result = manager.bind(toBindInput(command, 'CommandOrControl+Shift+F'))
    assert.equal(result.success, false)
    assert.equal(result.state, 'shortcut-conflict')
    assert.ok(result.binding)
  })

  it('handles malformed store, removeByPlugin, unbind, and destroy lifecycle', async (t) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mulby-cmd-shortcuts-'))
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    await writeFile(path.join(tempDir, 'plugin-command-shortcuts.json'), '{ bad-json ')

    const shortcuts = new MockGlobalShortcut()
    const plugins = new Map<string, Plugin>([
      ['plugin.alpha', createPlugin('plugin.alpha', true, 'Alpha')],
      ['plugin.beta', createPlugin('plugin.beta', true, 'Beta')]
    ])
    const commandAlpha = createCommand({
      pluginId: 'plugin.alpha',
      pluginName: 'plugin.alpha',
      pluginDisplayName: 'Alpha',
      featureCode: 'feature.alpha',
      featureExplain: 'Alpha Feature',
      cmdId: 'alpha',
      cmdSignature: 'keyword|alpha',
      displayLabel: 'alpha'
    })
    const commandBeta = createCommand({
      pluginId: 'plugin.beta',
      pluginName: 'plugin.beta',
      pluginDisplayName: 'Beta',
      featureCode: 'feature.beta',
      featureExplain: 'Beta Feature',
      cmdId: 'beta',
      cmdSignature: 'keyword|beta',
      displayLabel: 'beta'
    })
    const commands = [commandAlpha, commandBeta]

    const manager = new PluginCommandShortcutManager(
      {
        listCommands: (pluginId?: string) => commands.filter((item) => !pluginId || item.pluginId === pluginId),
        getPlugin: (pluginId: string) => plugins.get(pluginId),
        runPluginCommand: async () => ({ success: true })
      },
      {
        app: { getPath: () => tempDir },
        globalShortcut: shortcuts
      }
    )

    assert.equal(manager.listBindings().length, 0)

    const bindAlpha = manager.bind(toBindInput(commandAlpha, 'CommandOrControl+Shift+A'))
    const bindBeta = manager.bind(toBindInput(commandBeta, 'CommandOrControl+Shift+B'))
    assert.equal(bindAlpha.success, true)
    assert.equal(bindBeta.success, true)

    manager.removeByPlugin('plugin.alpha')
    const remaining = manager.listBindings()
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].pluginId, 'plugin.beta')

    manager.removeByPlugin('plugin.unknown')
    assert.equal(manager.unbind('not-exist-id'), false)
    assert.equal(manager.unbind(bindBeta.binding!.id), true)
    assert.equal(manager.listBindings().length, 0)

    const rebound = manager.bind(toBindInput(commandAlpha, 'CommandOrControl+Shift+C'))
    assert.equal(rebound.success, true)
    manager.destroy()
    assert.equal(shortcuts.hasActive('CommandOrControl+Shift+C'), false)
  })
})
