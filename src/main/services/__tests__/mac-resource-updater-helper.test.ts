import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

const helperPath = path.resolve('resources/updater/mulby-mac-resource-updater.cjs')

describe('mac resource updater helper', () => {
  it('replaces staged resources and writes logs', { skip: process.platform !== 'darwin' }, () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), 'mulby-helper-test-'))

    try {
      const appPath = path.join(rootDir, 'Mulby.app')
      const resourcesDir = path.join(appPath, 'Contents', 'Resources')
      mkdirSync(path.join(resourcesDir, 'internal-plugins'), { recursive: true })
      writeFileSync(path.join(resourcesDir, 'app.asar'), 'old-asar')
      writeFileSync(path.join(resourcesDir, 'internal-plugins', 'system.txt'), 'old-plugin')

      const stagingDir = path.join(rootDir, 'staging')
      mkdirSync(path.join(stagingDir, 'internal-plugins'), { recursive: true })
      writeFileSync(path.join(stagingDir, 'app.asar'), 'new-asar')
      writeFileSync(path.join(stagingDir, 'internal-plugins', 'system.txt'), 'new-plugin')

      const packagePath = path.join(rootDir, 'update.zip')
      execFileSync('/usr/bin/ditto', ['-c', '-k', stagingDir, packagePath])

      const userDataPath = path.join(rootDir, 'user-data')
      execFileSync(process.execPath, [
        helperPath,
        '--package',
        packagePath,
        '--app',
        appPath,
        '--pid',
        '0',
        '--version',
        '1.2.0',
        '--user-data',
        userDataPath,
        '--skip-wait',
        '--no-relaunch'
      ])

      assert.equal(readFileSync(path.join(resourcesDir, 'app.asar'), 'utf8'), 'new-asar')
      assert.equal(readFileSync(path.join(resourcesDir, 'internal-plugins', 'system.txt'), 'utf8'), 'new-plugin')
      const logText = readFileSync(path.join(userDataPath, 'logs', 'update-helper.log'), 'utf8')
      assert.match(logText, /Resource update applied/)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
