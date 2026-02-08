import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  executeSkillCreatorRunCommandTool
} from '../skills/creator-command-tool'
import {
  AI_SKILL_CREATOR_INTERNAL_TAG,
  type SkillCreatorResourcePack
} from '../skills/creator-resources'
import type { RunCommandInput, RunCommandResult } from '../../services/command-runner'

async function createSkillCreatorFixture(): Promise<SkillCreatorResourcePack> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'intools-skill-creator-tool-'))
  const scriptsPath = path.join(rootPath, 'scripts')
  await mkdir(scriptsPath, { recursive: true })
  await writeFile(path.join(rootPath, 'SKILL.md'), '# skill creator', 'utf8')
  await writeFile(path.join(scriptsPath, 'init_skill.py'), 'print("ok")', 'utf8')
  await writeFile(path.join(scriptsPath, 'helper.js'), 'console.log("ok")', 'utf8')
  return {
    rootPath,
    skillMdPath: path.join(rootPath, 'SKILL.md'),
    skillMdContent: '# skill creator',
    referenceFiles: [],
    scriptFiles: ['helper.js', 'init_skill.py']
  }
}

function createSuccessResult(input: RunCommandInput): RunCommandResult {
  return {
    success: true,
    command: input.command,
    args: input.args || [],
    cwd: input.cwd,
    shell: input.shell === true,
    stdout: 'ok',
    stderr: '',
    exitCode: 0,
    signal: null,
    durationMs: 12,
    timedOut: false,
    truncated: false
  }
}

describe('skill creator runCommand tool guard', () => {
  it('blocks plugin context interception', async (t) => {
    const pack = await createSkillCreatorFixture()
    t.after(async () => {
      await rm(pack.rootPath, { recursive: true, force: true })
    })

    let invoked = false
    await assert.rejects(
      executeSkillCreatorRunCommandTool(
        {
          command: 'python3',
          args: ['scripts/init_skill.py']
        },
        {
          pluginName: 'plugins.ai-api-test',
          internalTag: AI_SKILL_CREATOR_INTERNAL_TAG
        },
        {
          loadPack: async () => pack,
          runCommand: async () => {
            invoked = true
            throw new Error('should not execute')
          }
        }
      ),
      /仅允许内部调用/
    )
    assert.equal(invoked, false)
  })

  it('blocks illegal cwd outside skill-creator root', async (t) => {
    const pack = await createSkillCreatorFixture()
    t.after(async () => {
      await rm(pack.rootPath, { recursive: true, force: true })
    })

    let invoked = false
    await assert.rejects(
      executeSkillCreatorRunCommandTool(
        {
          command: 'python3',
          args: ['scripts/init_skill.py'],
          cwd: path.join(pack.rootPath, '..')
        },
        {
          internalTag: AI_SKILL_CREATOR_INTERNAL_TAG
        },
        {
          loadPack: async () => pack,
          runCommand: async () => {
            invoked = true
            throw new Error('should not execute')
          }
        }
      ),
      /cwd 必须位于/
    )
    assert.equal(invoked, false)
  })

  it('blocks path traversal escaping scripts directory', async (t) => {
    const pack = await createSkillCreatorFixture()
    t.after(async () => {
      await rm(pack.rootPath, { recursive: true, force: true })
    })

    let invoked = false
    await assert.rejects(
      executeSkillCreatorRunCommandTool(
        {
          command: 'python3',
          args: ['../outside.py']
        },
        {
          internalTag: AI_SKILL_CREATOR_INTERNAL_TAG
        },
        {
          loadPack: async () => pack,
          runCommand: async () => {
            invoked = true
            throw new Error('should not execute')
          }
        }
      ),
      /scripts 目录内脚本/
    )
    assert.equal(invoked, false)
  })

  it('allows internal invocation and forwards guarded command', async (t) => {
    const pack = await createSkillCreatorFixture()
    t.after(async () => {
      await rm(pack.rootPath, { recursive: true, force: true })
    })

    let captured: RunCommandInput | undefined
    const result = await executeSkillCreatorRunCommandTool(
      {
        command: 'python3',
        args: ['scripts/init_skill.py', '--path', 'skills/demo'],
        cwd: pack.rootPath
      },
      {
        internalTag: AI_SKILL_CREATOR_INTERNAL_TAG
      },
      {
        loadPack: async () => pack,
        runCommand: async (input) => {
          captured = input
          return createSuccessResult(input)
        }
      }
    )

    assert.equal(result.success, true)
    assert.equal(captured?.shell, false)
    assert.equal(captured?.cwd, pack.rootPath)
    assert.deepEqual(captured?.args, ['scripts/init_skill.py', '--path', 'skills/demo'])
  })

  it('returns structured failure when runCommand throws', async (t) => {
    const pack = await createSkillCreatorFixture()
    t.after(async () => {
      await rm(pack.rootPath, { recursive: true, force: true })
    })

    const result = await executeSkillCreatorRunCommandTool(
      {
        command: 'python3',
        args: ['scripts/init_skill.py']
      },
      {
        internalTag: AI_SKILL_CREATOR_INTERNAL_TAG
      },
      {
        loadPack: async () => pack,
        runCommand: async () => {
          throw new Error('policy blocked')
        }
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.error, 'policy blocked')
    assert.equal(result.stderr, 'policy blocked')
  })
})
