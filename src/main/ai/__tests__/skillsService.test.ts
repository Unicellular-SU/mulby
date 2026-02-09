import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { AiSettings } from '../../../shared/types/ai'
import { AiSkillService } from '../skills'

async function createTempDir(prefix: string): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), prefix))
}

function createInMemorySkillService(input: { settings: AiSettings; userDataPath: string; homeDir?: string }) {
  let settings = input.settings
  const service = new AiSkillService({
    getSettings: () => settings,
    updateSettings: (partial) => {
      settings = {
        ...settings,
        ...partial,
        mcp: partial.mcp ?? settings.mcp,
        skills: partial.skills ?? settings.skills
      }
      return settings
    },
    now: () => 1_700_000_000_000,
    getUserDataPath: () => input.userDataPath,
    getHomeDir: () => input.homeDir || os.homedir()
  })
  return {
    service,
    getSettings: () => settings
  }
}

describe('skill service', () => {
  it('creates skill and resolves manual selection with MCP scope merge', async (t) => {
    const tempDir = await createTempDir('intools-skill-test-')
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const { service } = createInMemorySkillService({
      userDataPath: tempDir,
      settings: {
        providers: [],
        models: [],
        mcp: { servers: [] },
        skills: {
          enabled: true,
          activeSkillIds: [],
          autoSelect: { enabled: false, maxSkillsPerCall: 3, minScore: 1 },
          records: []
        }
      }
    })

    const created = await service.create({
      name: 'Code Review',
      promptTemplate: 'You are a strict reviewer.',
      capabilities: ['fs.read'],
      internalTools: ['intools_read_file'],
      enabled: true,
      trustLevel: 'trusted',
      mcpPolicy: {
        serverIds: ['filesystem'],
        allowedToolIds: ['mcp__filesystem__read_file']
      }
    })

    const resolved = service.resolveForAiCall({
      model: 'openai:gpt-4o-mini',
      messages: [{ role: 'user', content: 'please review this patch' }],
      mcp: {
        mode: 'auto',
        serverIds: ['filesystem', 'web'],
        allowedToolIds: ['mcp__filesystem__read_file', 'mcp__web__search']
      },
      skills: {
        mode: 'manual',
        skillIds: [created.id]
      }
    })

    assert.equal(resolved.selectedSkillIds.length, 1)
    assert.deepEqual(resolved.selectedSkills?.map((item) => item.id), [created.id])
    assert.deepEqual(resolved.capabilities, ['fs.read'])
    assert.deepEqual(resolved.internalTools, ['intools_read_file'])
    assert.deepEqual(resolved.mergedMcp?.serverIds, ['filesystem'])
    assert.deepEqual(resolved.mergedMcp?.allowedToolIds, ['mcp__filesystem__read_file'])

    const applied = service.applyResolutionToOption(
      {
        messages: [{ role: 'user', content: 'review now' }],
        skills: { mode: 'manual', skillIds: [created.id] }
      },
      resolved
    )
    assert.equal(applied.messages[0].role, 'system')
    assert.equal(typeof applied.messages[0].content, 'string')
  })

  it('keeps explicit MCP selection when skills are only implicitly active, and merges when skills are explicit', async (t) => {
    const tempDir = await createTempDir('intools-skill-mcp-precedence-')
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const { service } = createInMemorySkillService({
      userDataPath: tempDir,
      settings: {
        providers: [],
        models: [],
        mcp: { servers: [] },
        skills: {
          enabled: true,
          activeSkillIds: [],
          autoSelect: { enabled: false, maxSkillsPerCall: 3, minScore: 1 },
          records: []
        }
      }
    })

    const created = await service.create({
      id: 'skill-mcp-policy',
      name: 'Skill MCP Policy',
      promptTemplate: 'Use MCP skill policy when explicitly selected.',
      enabled: true,
      trustLevel: 'trusted',
      mcpPolicy: {
        serverIds: ['skill-server'],
        allowedToolIds: ['mcp__skill-server__skill_tool']
      }
    })

    const implicitResolved = service.resolveForAiCall({
      messages: [{ role: 'user', content: 'run task' }],
      mcp: {
        mode: 'manual',
        serverIds: ['manual-server'],
        allowedToolIds: ['mcp__manual-server__manual_tool']
      }
    })

    const implicitApplied = service.applyResolutionToOption({
      messages: [{ role: 'user', content: 'run task' }],
      mcp: {
        mode: 'manual',
        serverIds: ['manual-server'],
        allowedToolIds: ['mcp__manual-server__manual_tool']
      }
    }, implicitResolved)

    assert.deepEqual(implicitApplied.mcp?.serverIds, ['manual-server'])
    assert.deepEqual(implicitApplied.mcp?.allowedToolIds, ['mcp__manual-server__manual_tool'])
    assert.equal(implicitApplied.mcp?.mode, 'manual')

    const explicitResolved = service.resolveForAiCall({
      messages: [{ role: 'user', content: 'run task' }],
      mcp: {
        mode: 'manual',
        serverIds: ['manual-server', 'skill-server'],
        allowedToolIds: ['mcp__manual-server__manual_tool', 'mcp__skill-server__skill_tool']
      },
      skills: {
        mode: 'manual',
        skillIds: [created.id]
      }
    })

    const explicitApplied = service.applyResolutionToOption({
      messages: [{ role: 'user', content: 'run task' }],
      mcp: {
        mode: 'manual',
        serverIds: ['manual-server', 'skill-server'],
        allowedToolIds: ['mcp__manual-server__manual_tool', 'mcp__skill-server__skill_tool']
      },
      skills: {
        mode: 'manual',
        skillIds: [created.id]
      }
    }, explicitResolved)

    assert.deepEqual(explicitApplied.mcp?.serverIds, ['skill-server'])
    assert.deepEqual(explicitApplied.mcp?.allowedToolIds, ['mcp__skill-server__skill_tool'])
    assert.equal(explicitApplied.mcp?.mode, 'manual')
  })

  it('imports from JSON and provides preview output', async (t) => {
    const tempDir = await createTempDir('intools-skill-json-')
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const { service } = createInMemorySkillService({
      userDataPath: tempDir,
      settings: {
        providers: [],
        models: [],
        mcp: { servers: [] },
        skills: {
          enabled: true,
          activeSkillIds: [],
          autoSelect: { enabled: false, maxSkillsPerCall: 2, minScore: 1 },
          records: []
        }
      }
    })

    const imported = await service.importFromJson({
      json: JSON.stringify({
        skills: [
          {
            id: 'planner',
            name: 'Task Planner',
            mode: 'manual',
            promptTemplate: 'Break down the task into steps.',
            triggerPhrases: ['plan', 'roadmap']
          }
        ]
      }),
      enabled: true,
      trustLevel: 'trusted'
    })

    assert.equal(imported.length, 1)
    const preview = service.preview({
      skillIds: [imported[0].id],
      prompt: 'please make a roadmap'
    })
    assert.equal(preview.selected.length, 1)
    assert.equal(preview.systemPrompt.includes('Break down the task'), true)
  })

  it('installs skill from local directory', async (t) => {
    const tempDir = await createTempDir('intools-skill-install-')
    const sourceDir = path.join(tempDir, 'source-skill')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(
      path.join(sourceDir, 'SKILL.md'),
      `---
id: fixer
name: Bug Fixer
mode: auto
triggerPhrases:
  - bug
  - fix
---
Provide concrete bug-fix steps.`,
      'utf8'
    )

    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const { service, getSettings } = createInMemorySkillService({
      userDataPath: tempDir,
      settings: {
        providers: [],
        models: [],
        mcp: { servers: [] },
        skills: {
          enabled: true,
          activeSkillIds: [],
          autoSelect: { enabled: true, maxSkillsPerCall: 2, minScore: 1 },
          records: []
        }
      }
    })

    const installed = await service.install({
      source: 'local-dir',
      ref: sourceDir,
      enabled: true,
      trustLevel: 'reviewed'
    })

    assert.equal(installed.length, 1)
    assert.equal(installed[0].descriptor.name, 'Bug Fixer')
    assert.equal(getSettings().skills?.records.length, 1)

    const autoResolved = service.resolveForAiCall({
      messages: [{ role: 'user', content: 'please fix this bug quickly' }],
      skills: { mode: 'auto' }
    })
    assert.equal(autoResolved.selectedSkillIds.length, 1)
  })

  it('refreshes catalog from system and app roots, app skills override system skills on conflict', async (t) => {
    const tempDir = await createTempDir('intools-skill-catalog-')
    const homeDir = await createTempDir('intools-skill-home-')
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
      await rm(homeDir, { recursive: true, force: true })
    })

    const systemSkillDir = path.join(homeDir, '.agents', 'skills', 'shared')
    await mkdir(systemSkillDir, { recursive: true })
    await writeFile(path.join(systemSkillDir, 'SKILL.md'), `---
id: shared-skill
name: Shared Skill (System)
mode: both
---
System prompt`, 'utf8')

    const appSkillDir = path.join(tempDir, 'ai', 'skills', 'app', 'shared')
    await mkdir(appSkillDir, { recursive: true })
    await writeFile(path.join(appSkillDir, 'SKILL.md'), `---
id: shared-skill
name: Shared Skill (App)
mode: both
---
App prompt`, 'utf8')

    const { service } = createInMemorySkillService({
      userDataPath: tempDir,
      homeDir,
      settings: {
        providers: [],
        models: [],
        mcp: { servers: [] },
        skills: {
          enabled: true,
          activeSkillIds: [],
          autoSelect: { enabled: false, maxSkillsPerCall: 3, minScore: 1 },
          records: []
        }
      }
    })

    const records = await service.refreshCatalog()
    assert.equal(records.length >= 1, true)
    const merged = records.find((item) => item.id === 'shared-skill')
    assert.equal(!!merged, true)
    assert.equal(merged?.descriptor.name, 'Shared Skill (App)')
    assert.equal(merged?.origin, 'app')
    assert.equal(merged?.readonly, false)
  })

  it('treats system skills as read-only for descriptor mutation/removal', async (t) => {
    const tempDir = await createTempDir('intools-skill-system-readonly-')
    const homeDir = await createTempDir('intools-skill-home-readonly-')
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
      await rm(homeDir, { recursive: true, force: true })
    })

    const systemSkillDir = path.join(homeDir, '.agents', 'skills', 'readonly-skill')
    await mkdir(systemSkillDir, { recursive: true })
    await writeFile(path.join(systemSkillDir, 'SKILL.md'), `---
id: system-readonly
name: System Readonly
mode: both
---
System prompt`, 'utf8')

    const { service } = createInMemorySkillService({
      userDataPath: tempDir,
      homeDir,
      settings: {
        providers: [],
        models: [],
        mcp: { servers: [] },
        skills: {
          enabled: true,
          activeSkillIds: [],
          autoSelect: { enabled: false, maxSkillsPerCall: 3, minScore: 1 },
          records: []
        }
      }
    })

    await service.refreshCatalog()
    const readonly = service.get('system-readonly')
    assert.equal(!!readonly, true)
    assert.equal(readonly?.origin, 'system')

    await assert.rejects(
      service.update('system-readonly', {
        descriptor: {
          ...readonly!.descriptor,
          promptTemplate: 'mutated'
        }
      }),
      /read-only/
    )
    await assert.rejects(service.remove('system-readonly'), /read-only/)

    const enabled = await service.enable('system-readonly')
    assert.equal(enabled.enabled, true)
  })

  it('creates generated skill files and blocks unsafe generated file paths', async (t) => {
    const tempDir = await createTempDir('intools-skill-generated-')
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const { service } = createInMemorySkillService({
      userDataPath: tempDir,
      settings: {
        providers: [],
        models: [],
        mcp: { servers: [] },
        skills: {
          enabled: true,
          activeSkillIds: [],
          autoSelect: { enabled: false, maxSkillsPerCall: 3, minScore: 1 },
          records: []
        }
      }
    })

    const created = await service.createFromGenerated({
      name: 'Generated Skill',
      skillMarkdown: `---
id: generated-skill
name: Generated Skill
mode: both
---
Generated prompt`,
      files: [
        {
          path: 'references/workflows.md',
          content: '# workflow'
        }
      ]
    })
    assert.equal(created.id.startsWith('generated-skill'), true)
    const refPath = path.join(created.installPath || '', 'references', 'workflows.md')
    const refContent = await readFile(refPath, 'utf8')
    assert.equal(refContent, '# workflow')

    await assert.rejects(
      service.createFromGenerated({
        name: 'Unsafe Skill',
        files: [{ path: '../hack.sh', content: 'echo hack' }]
      }),
      /Unsafe generated file path/
    )
  })

  it('replaces existing generated skill when replaceSkillId is provided', async (t) => {
    const tempDir = await createTempDir('intools-skill-generated-replace-')
    t.after(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    const { service } = createInMemorySkillService({
      userDataPath: tempDir,
      settings: {
        providers: [],
        models: [],
        mcp: { servers: [] },
        skills: {
          enabled: true,
          activeSkillIds: [],
          autoSelect: { enabled: false, maxSkillsPerCall: 3, minScore: 1 },
          records: []
        }
      }
    })

    const first = await service.createFromGenerated({
      id: 'iterative-skill',
      name: 'Iterative Skill',
      description: 'v1',
      promptTemplate: 'first version'
    })
    const second = await service.createFromGenerated({
      replaceSkillId: first.id,
      name: 'Iterative Skill',
      description: 'v2',
      promptTemplate: 'second version'
    })

    assert.equal(second.id, first.id)
    const all = service.list().filter((item) => item.id === first.id)
    assert.equal(all.length, 1)
    const skillMd = await readFile(path.join(second.installPath || '', 'SKILL.md'), 'utf8')
    assert.equal(skillMd.includes('description: v2'), true)
    assert.equal(skillMd.includes('second version'), true)
  })
})
