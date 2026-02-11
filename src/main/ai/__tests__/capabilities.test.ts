import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mapCapabilitiesToInternalToolNames,
  mapInternalToolsToCapabilities,
  normalizeAiToolCapabilityNames
} from '../tools/capabilities'
import { resolveAiCapabilityPolicy } from '../tools/capability-policy'

describe('ai tool capabilities', () => {
  it('normalizes aliases and deduplicates capabilities', () => {
    const normalized = normalizeAiToolCapabilityNames([
      'shell.exec',
      'runCommand',
      'SHELL:RUNCOMMAND',
      'fs.read',
      'readFile',
      'unknown'
    ])
    assert.deepEqual(normalized, ['shell.exec', 'fs.read'])
  })

  it('maps legacy internal tool names to capabilities', () => {
    const capabilities = mapInternalToolsToCapabilities(['mulby_run_command', 'runCommand', 'mulby_read_file'])
    assert.deepEqual(capabilities, ['shell.exec', 'fs.read'])
  })

  it('maps capabilities to internal tool names', () => {
    const tools = mapCapabilitiesToInternalToolNames(['shell.exec', 'fs.read'])
    assert.deepEqual(tools, ['mulby_run_command', 'mulby_read_file'])
  })
})

describe('ai capability policy', () => {
  it('uses global default capabilities even when skills are selected', () => {
    const result = resolveAiCapabilityPolicy({
      option: {
        messages: [{ role: 'user', content: 'run command' }]
      },
      requestedCapabilities: ['shell.exec', 'fs.read'],
      selectedSkills: [{
        id: 'find-skills',
        source: 'zip',
        trustLevel: 'reviewed'
      }]
    })
    assert.deepEqual(result.allowedCapabilities, ['shell.exec', 'fs.read'])
    assert.deepEqual(result.deniedCapabilities, [])
  })

  it('global deny takes precedence over session allow', () => {
    const result = resolveAiCapabilityPolicy({
      option: {
        messages: [{ role: 'user', content: 'run command' }],
        toolingPolicy: {
          capabilityAllowList: ['shell.exec']
        }
      },
      requestedCapabilities: ['shell.exec'],
      policy: {
        defaultAppCapabilities: [],
        globalGrants: [{
          id: 'deny-shell',
          decision: 'deny',
          capability: 'shell.exec'
        }]
      }
    })
    assert.deepEqual(result.allowedCapabilities, [])
    assert.deepEqual(result.deniedCapabilities, ['shell.exec'])
  })

  it('allows global grants', () => {
    const result = resolveAiCapabilityPolicy({
      option: {
        messages: [{ role: 'user', content: 'run command' }]
      },
      requestedCapabilities: ['shell.exec'],
      policy: {
        defaultAppCapabilities: [],
        globalGrants: [
          {
            id: 'allow-shell-global',
            decision: 'allow',
            capability: 'shell.exec'
          }
        ]
      }
    })
    assert.deepEqual(result.allowedCapabilities, ['shell.exec'])
    assert.deepEqual(result.deniedCapabilities, [])
  })

  it('ignores unknown legacy fields in final cleanup stage', () => {
    const result = resolveAiCapabilityPolicy({
      option: {
        messages: [{ role: 'user', content: 'run command' }]
      },
      requestedCapabilities: ['shell.exec'],
      policy: {
        defaultAppCapabilities: [],
        globalGrants: [],
        ...({
          grants: [
            {
              id: 'legacy-allow-shell',
              decision: 'allow',
              capability: 'shell.exec'
            }
          ]
        } as Record<string, unknown>)
      }
    })
    assert.deepEqual(result.allowedCapabilities, [])
    assert.deepEqual(result.deniedCapabilities, ['shell.exec'])
  })

  it('allows default app capabilities in normal ai calls by default', () => {
    const result = resolveAiCapabilityPolicy({
      option: {
        messages: [{ role: 'user', content: 'check repo status' }]
      },
      requestedCapabilities: []
    })
    assert.equal(result.allowedCapabilities.includes('shell.exec'), true)
    assert.equal(result.allowedCapabilities.includes('git.status'), true)
  })

  it('uses global app capabilities for reviewed system skills', () => {
    const result = resolveAiCapabilityPolicy({
      option: {
        messages: [{ role: 'user', content: '请帮我运行命令检查技能' }]
      },
      requestedCapabilities: [],
      selectedSkills: [{
        id: 'find-skills',
        source: 'system',
        trustLevel: 'reviewed'
      }]
    })
    assert.equal(result.allowedCapabilities.includes('shell.exec'), true)
  })

  it('does not auto-request internal capabilities when custom tools are declared', () => {
    const result = resolveAiCapabilityPolicy({
      option: {
        messages: [{ role: 'user', content: 'run command' }],
        tools: [{
          type: 'function',
          function: {
            name: 'custom_tool',
            description: 'custom',
            parameters: {
              type: 'object',
              properties: {}
            }
          }
        }]
      },
      requestedCapabilities: []
    })
    assert.deepEqual(result.allowedCapabilities, [])
    assert.deepEqual(result.deniedCapabilities, [])
  })
})
