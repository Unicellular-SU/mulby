import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AI_RUN_COMMAND_TOOL_NAME,
  buildAiRunCommandTool,
  normalizeFailedRunCommandResult,
  parseAiRunCommandArgs
} from '../tools/run-command-tool'

describe('ai runCommand tool', () => {
  it('builds tool schema with expected name', () => {
    const tool = buildAiRunCommandTool()
    assert.equal(tool.type, 'function')
    assert.equal(tool.function?.name, AI_RUN_COMMAND_TOOL_NAME)
    const schema = tool.function?.parameters as { required?: string[] } | undefined
    assert.equal(Array.isArray(schema?.required), true)
    assert.equal(schema?.required?.includes('command'), true)
  })

  it('parses runCommand args object', () => {
    const parsed = parseAiRunCommandArgs({
      command: 'node',
      args: ['-e', 'console.log("ok")'],
      cwd: '/tmp',
      env: { NODE_ENV: 'test', RETRIES: 3 },
      timeoutMs: 12000,
      shell: false
    })
    assert.equal(parsed.command, 'node')
    assert.deepEqual(parsed.args, ['-e', 'console.log("ok")'])
    assert.equal(parsed.cwd, '/tmp')
    assert.equal(parsed.timeoutMs, 12000)
    assert.deepEqual(parsed.env, { NODE_ENV: 'test', RETRIES: '3' })
  })

  it('rejects invalid args payload', () => {
    assert.throws(() => parseAiRunCommandArgs(null), /object/)
    assert.throws(() => parseAiRunCommandArgs({}), /required/)
  })

  it('normalizes failure payload for tool result', () => {
    const result = normalizeFailedRunCommandResult({
      error: new Error('blocked'),
      command: 'node',
      args: ['-v']
    })
    assert.equal(result.success, false)
    assert.equal(result.stderr, 'blocked')
    assert.equal(result.error, 'blocked')
    assert.equal(result.command, 'node')
    assert.deepEqual(result.args, ['-v'])
  })
})
