import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import {
  findFirstExistingIcon,
  getAppWindowIconCandidates,
  getRuntimeIconRoots
} from '../window-icon-paths'

describe('window icon path resolution', () => {
  it('prefers the packaged tray ico for Windows taskbar windows', () => {
    const root = join('C:', 'Mulby')
    const candidates = getAppWindowIconCandidates([root], 'win32')

    assert.equal(candidates[0], join(root, 'resources', 'tray', 'icon.ico'))
    assert.ok(
      candidates.indexOf(join(root, 'resources', 'tray', 'icon.ico')) <
      candidates.indexOf(join(root, 'resources', 'tray', 'icon.png'))
    )
  })

  it('includes packaged and unpacked runtime resource roots', () => {
    const appPath = join('C:', 'Mulby', 'resources', 'app.asar')
    const resourcesPath = join('C:', 'Mulby', 'resources')
    const execPath = join('C:', 'Mulby', 'Mulby.exe')

    const roots = getRuntimeIconRoots({
      appPath,
      cwd: join('D:', 'Node.js', 'mulby'),
      execPath,
      resourcesPath
    })

    assert.ok(roots.includes(appPath))
    assert.ok(roots.includes(dirname(appPath)))
    assert.ok(roots.includes(join(resourcesPath, 'app.asar.unpacked')))
    assert.ok(roots.includes(dirname(execPath)))
  })

  it('returns the first existing candidate', () => {
    const candidates = ['missing.ico', 'present.ico', 'later.png']

    assert.equal(
      findFirstExistingIcon(candidates, (candidate) => candidate === 'present.ico'),
      'present.ico'
    )
  })
})
