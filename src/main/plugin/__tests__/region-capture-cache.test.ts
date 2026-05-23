import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const regionCaptureSourcePath = join(process.cwd(), 'src/main/plugin/region-capture.ts')

describe('region capture cache lifecycle', () => {
  it('clears cache after ordinary startRegionCapture calls so repeated long-press capture opens the selector again', () => {
    const source = readFileSync(regionCaptureSourcePath, 'utf8')
    const startRegionCapture = source.match(/export async function startRegionCapture\(\): Promise<string \| null> \{[\s\S]*?\n\}/)

    assert.ok(startRegionCapture, 'startRegionCapture must exist')
    assert.match(source, /function clearCachedRegionCaptureResult\(\): void \{[\s\S]*cachedCaptureResult = null/)
    assert.match(
      startRegionCapture[0],
      /const result = await startRegionCaptureDetailed\(\)[\s\S]*clearCachedRegionCaptureResult\(\)[\s\S]*return result\?\.dataUrl \?\? null/,
      'ordinary startRegionCapture must not leave a fresh result cached for the next invocation'
    )
  })
})
