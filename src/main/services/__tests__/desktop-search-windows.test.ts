import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SearchRanking } from '../../plugin/search/ranking'
import { WindowsSearchProvider } from '../../plugin/search/providers/win'
import type { SearchExecutionContext } from '../../plugin/search/types'
import { SYSTEM_SEARCH_MAX_QUERY_LENGTH } from '../../../shared/system-search'

function createExecutionHarness() {
  const runCommandCalls: Array<{ cmd: string; args: string[]; limit: number; searchKey: string }> = []
  const cancelled: string[] = []

  const execution: SearchExecutionContext = {
    runCommand: async (cmd, args, limit, searchKey) => {
      runCommandCalls.push({ cmd, args, limit, searchKey })
      return []
    },
    runQuickCommand: async () => '',
    cancelSearchProcess: (searchKey) => {
      cancelled.push(searchKey)
    },
    isKilledProcessError: () => false
  }

  return {
    execution,
    runCommandCalls,
    cancelled
  }
}

describe('WindowsSearchProvider system search query guard', () => {
  it('skips file search for oversized queries before spawning commands', async () => {
    const { execution, runCommandCalls, cancelled } = createExecutionHarness()
    const provider = new WindowsSearchProvider(execution, new SearchRanking())

    const result = await provider.searchFiles('a'.repeat(SYSTEM_SEARCH_MAX_QUERY_LENGTH + 1), 12)

    assert.deepEqual(result, [])
    assert.equal(runCommandCalls.length, 0)
    assert.deepEqual(cancelled, ['win-files', 'win-files-fallback'])
  })

  it('skips app search for oversized queries before spawning commands', async () => {
    const { execution, runCommandCalls, cancelled } = createExecutionHarness()
    const provider = new WindowsSearchProvider(execution, new SearchRanking())

    const result = await provider.searchApps('a'.repeat(SYSTEM_SEARCH_MAX_QUERY_LENGTH + 1), 12)

    assert.deepEqual(result, [])
    assert.equal(runCommandCalls.length, 0)
    assert.deepEqual(cancelled, [])
  })
})
