import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

const helperPath = path.resolve('resources/updater/mulby-mac-resource-updater.cjs')
const require = createRequire(import.meta.url)
const asar = require('@electron/asar') as {
  createPackage: (source: string, destination: string) => Promise<void>
  extractFile: (archive: string, filename: string) => Buffer
}
const electronPath = require('electron') as string

async function createAsarArchive(rootDir: string, name: string, destination: string, marker: string): Promise<void> {
  const sourceDir = path.join(rootDir, `${name}-source`)
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(path.join(sourceDir, 'package.json'), `${JSON.stringify({ main: 'index.js' }, null, 2)}\n`)
  writeFileSync(path.join(sourceDir, 'index.js'), `module.exports = ${JSON.stringify(marker)}\n`)
  await asar.createPackage(sourceDir, destination)
}

describe('mac resource updater helper', () => {
  it('replaces staged resources and writes logs', { skip: process.platform !== 'darwin' }, () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), 'mulby-helper-test-'))

    try {
      const appPath = path.join(rootDir, 'Mulby.app')
      const resourcesDir = path.join(appPath, 'Contents', 'Resources')
      mkdirSync(path.join(resourcesDir, 'internal-plugins'), { recursive: true })
      mkdirSync(path.join(resourcesDir, 'updater'), { recursive: true })
      writeFileSync(path.join(resourcesDir, 'app.asar'), 'old-asar')
      writeFileSync(path.join(resourcesDir, 'internal-plugins', 'system.txt'), 'old-plugin')
      writeFileSync(path.join(resourcesDir, 'updater', 'helper.txt'), 'old-helper')

      const stagingDir = path.join(rootDir, 'staging')
      mkdirSync(path.join(stagingDir, 'internal-plugins'), { recursive: true })
      mkdirSync(path.join(stagingDir, 'updater'), { recursive: true })
      writeFileSync(path.join(stagingDir, 'app.asar'), 'new-asar')
      writeFileSync(path.join(stagingDir, 'internal-plugins', 'system.txt'), 'new-plugin')
      writeFileSync(path.join(stagingDir, 'updater', 'helper.txt'), 'new-helper')

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
      assert.equal(readFileSync(path.join(resourcesDir, 'updater', 'helper.txt'), 'utf8'), 'new-helper')
      const logText = readFileSync(path.join(userDataPath, 'logs', 'update-helper.log'), 'utf8')
      assert.match(logText, /Resource update applied/)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('copies app.asar as a real file when run through Electron', { skip: process.platform !== 'darwin' }, async () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), 'mulby-helper-electron-test-'))

    try {
      const appPath = path.join(rootDir, 'Mulby.app')
      const resourcesDir = path.join(appPath, 'Contents', 'Resources')
      mkdirSync(resourcesDir, { recursive: true })
      await createAsarArchive(rootDir, 'old-asar', path.join(resourcesDir, 'app.asar'), 'old-asar')

      const stagingDir = path.join(rootDir, 'staging')
      mkdirSync(stagingDir, { recursive: true })
      await createAsarArchive(rootDir, 'new-asar', path.join(stagingDir, 'app.asar'), 'new-asar')

      const packagePath = path.join(rootDir, 'update.zip')
      execFileSync('/usr/bin/ditto', ['-c', '-k', stagingDir, packagePath])

      const userDataPath = path.join(rootDir, 'user-data')
      execFileSync(electronPath, [
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
      ], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1'
        }
      })

      const updatedEntry = asar.extractFile(path.join(resourcesDir, 'app.asar'), 'index.js').toString('utf8')
      assert.match(updatedEntry, /new-asar/)
      const logText = readFileSync(path.join(userDataPath, 'logs', 'update-helper.log'), 'utf8')
      assert.match(logText, /Backing up app\.asar/)
      assert.match(logText, /Resource update applied/)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
