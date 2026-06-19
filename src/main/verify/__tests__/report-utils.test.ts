import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeVerdict,
  describeManifestProblem,
  describeTriggers,
  firstKeyword,
  isPlatformCompatible
} from '../report-utils'
import type { PluginFeature } from '../../../shared/types/plugin'
import type { VerifyCheck } from '../../../shared/types/plugin-verify'

function feature(cmds: unknown[]): PluginFeature {
  return { code: 'echo', explain: '', cmds } as unknown as PluginFeature
}

describe('report-utils', () => {
  it('describeTriggers lists keyword and regex rules', () => {
    const f = feature([
      { type: 'keyword', value: 'hi' },
      { type: 'regex', match: '^a' }
    ])
    assert.deepEqual(describeTriggers(f), ['keyword:hi', 'regex:^a'])
  })

  it('firstKeyword returns the first keyword value', () => {
    const f = feature([
      { type: 'regex', match: '^a' },
      { type: 'keyword', value: 'kw' }
    ])
    assert.equal(firstKeyword(f), 'kw')
  })

  it('firstKeyword returns undefined when there is no keyword', () => {
    const f = feature([{ type: 'regex', match: '^a' }])
    assert.equal(firstKeyword(f), undefined)
  })

  it('computeVerdict fails when any check fails', () => {
    const checks: VerifyCheck[] = [
      { id: 'a', title: 'a', status: 'pass' },
      { id: 'b', title: 'b', status: 'fail' }
    ]
    assert.equal(computeVerdict(checks, [], false).ok, false)
  })

  it('computeVerdict passes when only warns and not strict', () => {
    const checks: VerifyCheck[] = [{ id: 'a', title: 'a', status: 'warn' }]
    assert.equal(computeVerdict(checks, [], false).ok, true)
  })

  it('computeVerdict fails on warn under strict', () => {
    const checks: VerifyCheck[] = [{ id: 'a', title: 'a', status: 'warn' }]
    assert.equal(computeVerdict(checks, [], true).ok, false)
  })

  it('computeVerdict fails when there are fatal errors', () => {
    assert.equal(computeVerdict([], ['boom'], false).ok, false)
  })

  it('describeManifestProblem reports a missing manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mulby-verify-test-'))
    try {
      assert.match(describeManifestProblem(dir), /未找到 manifest\.json/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('describeManifestProblem reports a missing entry file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mulby-verify-test-'))
    try {
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({
          name: 'x',
          version: '1.0.0',
          displayName: 'X',
          main: 'main.js',
          features: [{ code: 'a', explain: '', cmds: [] }]
        })
      )
      assert.match(describeManifestProblem(dir), /入口文件不存在/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('describeManifestProblem reports missing required fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mulby-verify-test-'))
    try {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'x' }))
      assert.match(describeManifestProblem(dir), /缺少必需字段/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('isPlatformCompatible handles undefined, strings and arrays', () => {
    const other = process.platform === 'win32' ? 'darwin' : 'win32'
    assert.equal(isPlatformCompatible(undefined), true)
    assert.equal(isPlatformCompatible(process.platform), true)
    assert.equal(isPlatformCompatible([process.platform, other]), true)
    assert.equal(isPlatformCompatible(other), false)
    assert.equal(isPlatformCompatible([other]), false)
  })

  it('describeManifestProblem flags an incompatible platform', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mulby-verify-test-'))
    try {
      const other = process.platform === 'win32' ? 'darwin' : 'win32'
      writeFileSync(join(dir, 'main.js'), '')
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({
          name: 'x',
          version: '1.0.0',
          displayName: 'X',
          main: 'main.js',
          platform: other,
          features: [{ code: 'a', explain: '', cmds: [] }]
        })
      )
      assert.match(describeManifestProblem(dir), /不匹配/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('describeManifestProblem does not falsely flag a compatible platform', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mulby-verify-test-'))
    try {
      writeFileSync(join(dir, 'main.js'), '')
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({
          name: 'x',
          version: '1.0.0',
          displayName: 'X',
          main: 'main.js',
          platform: process.platform,
          features: [{ code: 'a', explain: '', cmds: [] }]
        })
      )
      assert.doesNotMatch(describeManifestProblem(dir), /不匹配/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
