import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()

test('split repo sync check script is exposed as a local package command', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(
    packageJson.scripts['check:split-sync'],
    'node scripts/check-split-repo-sync.mjs'
  )

  const scriptStat = statSync(join(root, 'scripts/check-split-repo-sync.mjs'))
  assert.equal(scriptStat.isFile(), true)
})
