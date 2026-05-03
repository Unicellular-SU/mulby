import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildHostIpcErrorMessage,
  logHostIpcError
} from '../../ipc/host-error-logging'

describe('host IPC error logging', () => {
  it('formats host:call errors with channel, method, and stack', () => {
    const error = new Error('ENOENT: missing file')
    error.stack = 'Error: ENOENT: missing file\n    at plugin-main.js:10:3'

    const message = buildHostIpcErrorMessage('host:call', 'loadSqlJs', error)

    assert.match(message, /Error occurred in handler for 'host:call' \(loadSqlJs\):/)
    assert.match(message, /ENOENT: missing file/)
    assert.match(message, /plugin-main\.js:10:3/)
  })

  it('writes failed host IPC calls under the plugin id for the log viewer', () => {
    const writes: Array<{ level: string; pluginId: string; message: string }> = []
    const logger = {
      write: (level: 'error', pluginId: string, message: string) => {
        writes.push({ level, pluginId, message })
      }
    }

    logHostIpcError(logger, 'host:invoke', 'vscode', 'filesystem.readFile', new Error('boom'))

    assert.equal(writes.length, 1)
    assert.equal(writes[0].level, 'error')
    assert.equal(writes[0].pluginId, 'vscode')
    assert.match(writes[0].message, /host:invoke/)
    assert.match(writes[0].message, /filesystem\.readFile/)
    assert.match(writes[0].message, /boom/)
  })
})
