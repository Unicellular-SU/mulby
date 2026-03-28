import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AI_RUN_COMMAND_TOOL_NAME,
  buildAiRunCommandTool,
  normalizeFailedRunCommandResult,
  parseAiRunCommandArgs
} from '../tools/run-command-tool'
import {
  parseCompatToolCallArgs,
  sanitizeControlCharsInJsonStrings
} from '../service/utils'

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

  it('parses stringified runCommand args payload', () => {
    const parsed = parseAiRunCommandArgs('{"command":"node","args":["-v"],"shell":false}')
    assert.equal(parsed.command, 'node')
    assert.deepEqual(parsed.args, ['-v'])
    assert.equal(parsed.shell, false)
  })

  it('parses double-stringified runCommand args payload', () => {
    const payload = JSON.stringify(JSON.stringify({ command: 'node', args: ['-v'], shell: false }))
    const parsed = parseAiRunCommandArgs(payload)
    assert.equal(parsed.command, 'node')
    assert.deepEqual(parsed.args, ['-v'])
    assert.equal(parsed.shell, false)
  })

  it('parses runCommand args with non-standard escaped characters from provider', () => {
    const payload = '{"command":"grep","args":["-i","预算\\\\|价格\\\\|金额\\\\|报价","/tmp/a.txt"]}'
    const parsed = parseAiRunCommandArgs(payload)
    assert.equal(parsed.command, 'grep')
    assert.deepEqual(parsed.args, ['-i', '预算\\|价格\\|金额\\|报价', '/tmp/a.txt'])
  })

  it('rejects invalid args payload', () => {
    assert.throws(() => parseAiRunCommandArgs(null), /got null/)
    assert.throws(() => parseAiRunCommandArgs({}), /required/)
  })

  it('parses runCommand args containing literal newlines from LLM output', () => {
    // Reproduces the exact bug: deepseek-chat produces JSON with literal newlines
    // inside string values when the AI writes multi-line content (e.g., a poem)
    // via powershell Set-Content command
    const payload = '{"command": "powershell", "args": ["-Command", "Set-Content -Path \'C:\\\\Users\\\\test\\\\Downloads\\\\poem.txt\' -Value \'第一行\n第二行\n第三行\' -Encoding UTF8"]}'
    const parsed = parseAiRunCommandArgs(payload)
    assert.equal(parsed.command, 'powershell')
    assert.equal(Array.isArray(parsed.args), true)
    assert.equal(parsed.args?.[0], '-Command')
    assert.ok(parsed.args?.[1]?.includes('Set-Content'))
  })

  it('parses pretty-printed runCommand args without corrupting structural whitespace', () => {
    // Regression test: pretty-printed JSON from provider must not be corrupted
    const payload = '{\n  "command": "node",\n  "args": ["-v"],\n  "shell": false\n}'
    const parsed = parseAiRunCommandArgs(payload)
    assert.equal(parsed.command, 'node')
    assert.deepEqual(parsed.args, ['-v'])
    assert.equal(parsed.shell, false)
  })

  it('parses pretty-printed JSON with non-standard escapes', () => {
    // Regression test: pretty-printed + non-standard escapes (the combo from codex review)
    const payload = '{\n  "command": "grep",\n  "args": ["-i", "a\\|b", "/tmp/a.txt"]\n}'
    const parsed = parseAiRunCommandArgs(payload)
    assert.equal(parsed.command, 'grep')
    assert.equal(parsed.args?.[1], 'a\\|b')
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

describe('sanitizeControlCharsInJsonStrings', () => {
  it('returns null when no control chars are inside strings', () => {
    assert.equal(sanitizeControlCharsInJsonStrings('{"a":"b"}'), null)
    // Structural whitespace is NOT inside strings, so no fix needed
    assert.equal(sanitizeControlCharsInJsonStrings('{\n  "a": "b"\n}'), null)
  })

  it('escapes literal newlines inside JSON string values', () => {
    const input = '{"value":"line1\nline2\nline3"}'
    const result = sanitizeControlCharsInJsonStrings(input)
    assert.equal(result, '{"value":"line1\\nline2\\nline3"}')
    // Verify it's now valid JSON
    const parsed = JSON.parse(result!)
    assert.equal(parsed.value, 'line1\nline2\nline3')
  })

  it('preserves structural whitespace in pretty-printed JSON', () => {
    const input = '{\n  "command": "node",\n  "value": "has\nnewline"\n}'
    const result = sanitizeControlCharsInJsonStrings(input)
    // Only the newline inside "value" should be escaped
    assert.ok(result !== null)
    const parsed = JSON.parse(result!)
    assert.equal(parsed.command, 'node')
    assert.equal(parsed.value, 'has\nnewline')
  })

  it('handles CRLF inside strings', () => {
    const input = '{"v":"a\r\nb"}'
    const result = sanitizeControlCharsInJsonStrings(input)
    assert.ok(result !== null)
    const parsed = JSON.parse(result!)
    assert.equal(parsed.v, 'a\nb')
  })

  it('does not double-escape already-escaped sequences', () => {
    // Already properly escaped \n should be left alone
    const input = '{"v":"a\\nb"}'
    const result = sanitizeControlCharsInJsonStrings(input)
    assert.equal(result, null) // no change needed
  })
})

describe('parseCompatToolCallArgs', () => {
  it('parses pretty-printed JSON from provider', () => {
    const raw = '{\n  "command": "grep",\n  "args": ["-i", "pattern"]\n}'
    const result = parseCompatToolCallArgs(raw)
    assert.deepEqual(result, { command: 'grep', args: ['-i', 'pattern'] })
  })

  it('recovers pretty-printed JSON with non-standard escapes', () => {
    const raw = '{\n  "command": "grep",\n  "args": ["-i", "a\\|b"]\n}'
    const result = parseCompatToolCallArgs(raw) as Record<string, unknown>
    assert.equal(result.command, 'grep')
    assert.deepEqual(result.args, ['-i', 'a\\|b'])
  })

  it('recovers JSON with literal newlines inside string values', () => {
    const raw = '{"command": "echo", "args": ["hello\nworld"]}'
    const result = parseCompatToolCallArgs(raw) as Record<string, unknown>
    assert.equal(result.command, 'echo')
    assert.deepEqual(result.args, ['hello\nworld'])
  })
})
