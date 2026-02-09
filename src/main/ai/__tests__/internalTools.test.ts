import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { AiToolingSettings } from '../../../shared/types/settings'
import {
  AI_GIT_STATUS_TOOL_NAME,
  AI_LIST_DIR_TOOL_NAME,
  AI_READ_FILE_TOOL_NAME,
  AI_RUN_SCRIPT_TOOL_NAME,
  AI_SEARCH_TEXT_TOOL_NAME,
  buildAiInternalTool,
  normalizeAiInternalToolNames
} from '../tools/internal-tools'
import { createAiInternalToolRuntime } from '../tools/internal-tool-runtime'

function createTooling(root: string): AiToolingSettings {
  return {
    enabled: true,
    filesystem: {
      allowedRoots: [root],
      maxReadBytes: 1024 * 1024,
      maxEntries: 1000,
      maxSearchHits: 100,
      maxSearchFileBytes: 1024 * 1024
    },
    patch: {
      allowedRoots: [root],
      maxPatchBytes: 1024 * 1024,
      requireDryRunFirst: true
    },
    http: {
      timeoutMs: 30_000,
      maxResponseBytes: 1024 * 1024,
      denyHosts: [],
      denyCidrs: [],
      denyUrlPrefixes: []
    },
    runScript: {
      entries: [
        {
          id: 'echo-script',
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.argv.slice(1).join(","))']
        }
      ],
      defaultTimeoutMs: 30_000,
      maxTimeoutMs: 300_000
    },
    git: {
      allowedRepoRoots: [root],
      maxDiffBytes: 1024 * 1024
    },
    capabilityPolicy: {
      defaultAppCapabilities: [],
      defaultSkillCapabilities: [],
      defaultNetworkSkillCapabilities: [],
      grants: []
    }
  }
}

describe('internal ai tools', () => {
  it('normalizes requested internal tool names', () => {
    const names = normalizeAiInternalToolNames(['intools_read_file', 'intools_read_file', 'unknown', ''])
    assert.deepEqual(names, ['intools_read_file'])

    const legacyNames = normalizeAiInternalToolNames(['runCommand', 'shell:runCommand', 'intools_run_command'])
    assert.deepEqual(legacyNames, ['intools_run_command'])
  })

  it('builds schema with parameters.required', () => {
    const tool = buildAiInternalTool(AI_READ_FILE_TOOL_NAME)
    const schema = tool.function?.parameters as { required?: string[] } | undefined
    assert.equal(Array.isArray(schema?.required), true)
    assert.equal(schema?.required?.includes('path'), true)
  })

  it('executes filesystem tools', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'intools-ai-tools-'))
    t.after(async () => {
      await rm(root, { recursive: true, force: true })
    })

    await mkdir(path.join(root, 'docs'), { recursive: true })
    await writeFile(path.join(root, 'docs', 'a.txt'), 'hello internal tools\nsecond line', 'utf8')

    const runtime = createAiInternalToolRuntime({
      getToolingSettings: () => createTooling(root),
      runCommand: async () => {
        throw new Error('not used')
      },
      resolveRunCommandContext: () => ({ source: 'app' })
    })

    const readResult = await runtime.execute({
      name: AI_READ_FILE_TOOL_NAME,
      args: { path: path.join(root, 'docs', 'a.txt') }
    }) as Record<string, unknown>
    assert.equal(readResult.success, true)
    assert.equal(String(readResult.content).includes('hello internal tools'), true)

    const listResult = await runtime.execute({
      name: AI_LIST_DIR_TOOL_NAME,
      args: { path: root, recursive: true }
    }) as Record<string, unknown>
    assert.equal(listResult.success, true)
    assert.equal(Array.isArray(listResult.entries), true)

    const searchResult = await runtime.execute({
      name: AI_SEARCH_TEXT_TOOL_NAME,
      args: { rootPath: root, query: 'second' }
    }) as Record<string, unknown>
    assert.equal(searchResult.success, true)
    const matches = searchResult.matches as Array<Record<string, unknown>>
    assert.equal(matches.length > 0, true)
  })

  it('runs registered script via run command bridge', async () => {
    let capturedCommand = ''
    let capturedArgs: string[] = []
    let capturedContext = ''

    const runtime = createAiInternalToolRuntime({
      getToolingSettings: () => createTooling(process.cwd()),
      runCommand: async (input, context) => {
        capturedCommand = input.command
        capturedArgs = input.args || []
        capturedContext = context.source
        return {
          success: true,
          command: input.command,
          args: input.args || [],
          cwd: input.cwd,
          shell: false,
          stdout: 'ok',
          stderr: '',
          exitCode: 0,
          signal: null,
          durationMs: 1,
          timedOut: false,
          truncated: false
        }
      },
      resolveRunCommandContext: () => ({ source: 'app' })
    })

    const result = await runtime.execute({
      name: AI_RUN_SCRIPT_TOOL_NAME,
      args: { scriptId: 'echo-script', args: ['A', 'B'] }
    }) as Record<string, unknown>

    assert.equal(result.success, true)
    assert.equal(capturedCommand, process.execPath)
    assert.equal(capturedArgs.includes('A'), true)
    assert.equal(capturedContext, 'app')
  })

  it('routes git tools through run command bridge', async () => {
    const captured: Array<{ command: string; args: string[] }> = []
    const runtime = createAiInternalToolRuntime({
      getToolingSettings: () => createTooling(process.cwd()),
      runCommand: async (input) => {
        captured.push({ command: input.command, args: input.args || [] })
        return {
          success: false,
          command: input.command,
          args: input.args || [],
          cwd: input.cwd,
          shell: false,
          stdout: '',
          stderr: 'not a git repository',
          exitCode: 128,
          signal: null,
          durationMs: 1,
          timedOut: false,
          truncated: false
        }
      },
      resolveRunCommandContext: () => ({ source: 'app' })
    })

    const result = await runtime.execute({
      name: AI_GIT_STATUS_TOOL_NAME,
      args: { repoPath: process.cwd() }
    }) as Record<string, unknown>

    assert.equal(result.success, false)
    assert.equal(captured.length > 0, true)
    assert.equal(captured[0]?.command, 'git')
  })
})
