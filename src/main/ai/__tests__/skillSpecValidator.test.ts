import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSkillMarkdown,
  decodeMulbyExtensions,
  encodeMulbyExtensions,
  validateSkillMarkdown
} from '../skills/spec-validator'

describe('skill spec validator', () => {
  it('accepts valid official frontmatter and body', () => {
    const markdown = buildSkillMarkdown({
      frontmatter: {
        name: 'pdf-processing',
        description: 'Process PDF files when user asks to extract or merge content.',
        license: 'Apache-2.0',
        compatibility: 'Requires filesystem access',
        metadata: {
          author: 'mulby',
          'mulby.mode': 'manual'
        },
        allowedTools: ['Read', 'Bash(git:*)']
      },
      body: 'Use this skill for PDF tasks.'
    })

    const result = validateSkillMarkdown(markdown, {
      skillDirPath: '/tmp/pdf-processing',
      filePath: '/tmp/pdf-processing/SKILL.md',
      requireCanonicalSkillFileName: true
    })

    assert.equal(result.ok, true)
    assert.equal(result.document?.frontmatter.name, 'pdf-processing')
    assert.equal(result.document?.frontmatter.allowedTools?.length, 2)
  })

  it('rejects unknown frontmatter keys', () => {
    const markdown = `---\nname: pdf-processing\ndescription: works\nmode: auto\n---\nbody`
    const result = validateSkillMarkdown(markdown, {
      skillDirPath: '/tmp/pdf-processing',
      filePath: '/tmp/pdf-processing/SKILL.md',
      requireCanonicalSkillFileName: true
    })
    assert.equal(result.ok, false)
    assert.match((result.errors || []).join('\n'), /unexpected frontmatter keys/i)
  })

  it('rejects invalid name and dir mismatch', () => {
    const markdown = `---\nname: PDF-Processing\ndescription: works\n---\nbody`
    const result = validateSkillMarkdown(markdown, {
      skillDirPath: '/tmp/pdf-processing',
      filePath: '/tmp/pdf-processing/SKILL.md',
      requireCanonicalSkillFileName: true
    })
    assert.equal(result.ok, false)
    assert.match((result.errors || []).join('\n'), /name must contain only lowercase/i)
  })

  it('encodes and decodes mulby metadata extensions', () => {
    const metadata = encodeMulbyExtensions({
      metadata: { author: 'mulby' },
      extensions: {
        mode: 'auto',
        triggerPhrases: ['bug', 'fix'],
        capabilities: ['fs.read'],
        internalTools: ['mulby_read_file'],
        mcpPolicy: {
          serverIds: ['filesystem'],
          allowedToolIds: ['mcp__filesystem__read_file']
        }
      }
    })

    const decoded = decodeMulbyExtensions(metadata)
    assert.equal(decoded.mode, 'auto')
    assert.deepEqual(decoded.triggerPhrases, ['bug', 'fix'])
    assert.deepEqual(decoded.capabilities, ['fs.read'])
    assert.deepEqual(decoded.internalTools, ['mulby_read_file'])
    assert.deepEqual(decoded.mcpPolicy?.serverIds, ['filesystem'])
  })
})
