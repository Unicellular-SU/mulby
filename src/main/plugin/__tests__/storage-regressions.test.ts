import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('PluginStorage regression guards', () => {
  const source = readFileSync(join(process.cwd(), 'src/main/plugin/storage.ts'), 'utf-8')

  it('does not migrate system namespaces into plugin-prefixed namespaces', () => {
    assert.match(source, /function isMigratableLegacyPluginNamespace\(namespace: string\): boolean/)
    assert.match(source, /namespace\.startsWith\('__system:'\)/)
    assert.match(source, /if \(!isMigratableLegacyPluginNamespace\(oldNs\)\) continue/)
  })

  it('escapes list prefixes before using SQL LIKE', () => {
    assert.match(source, /function escapeLikePrefix\(prefix: string\): string/)
    assert.match(source, /replace\(\s*\/\\\\\/g,\s*'\\\\\\\\'\s*\)/)
    assert.match(source, /const pattern = prefix \? `\$\{escapeLikePrefix\(prefix\)\}%` : '%'/)
    assert.match(source, /LIKE \? ESCAPE '\\\\'/)
  })
})
