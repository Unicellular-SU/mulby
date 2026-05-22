import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isExtensionOnlyIconRequest,
  isSyntheticSystemIconRequest,
  shouldUseNativeThumbnailForIcon
} from '../system'

describe('PluginSystem icon request classification', () => {
  it('detects extension-only requests without treating paths as extensions', () => {
    assert.equal(isExtensionOnlyIconRequest('.txt'), true)
    assert.equal(isExtensionOnlyIconRequest('.PDF'), true)
    assert.equal(isExtensionOnlyIconRequest('.tar.gz'), true)

    assert.equal(isExtensionOnlyIconRequest('/tmp/file.txt'), false)
    assert.equal(isExtensionOnlyIconRequest('file.txt'), false)
    assert.equal(isExtensionOnlyIconRequest('../.env'), false)
    assert.equal(isExtensionOnlyIconRequest('.'), false)
  })

  it('limits synthetic icon handling to extension-only requests and folder sentinel', () => {
    assert.equal(isSyntheticSystemIconRequest('.png'), true)
    assert.equal(isSyntheticSystemIconRequest('folder'), true)
    assert.equal(isSyntheticSystemIconRequest('FOLDER'), true)

    assert.equal(isSyntheticSystemIconRequest('/Applications/Safari.app'), false)
    assert.equal(isSyntheticSystemIconRequest('/Users/su/Documents'), false)
    assert.equal(isSyntheticSystemIconRequest('report.pdf'), false)
  })

  it('skips native thumbnail generation on Windows icon requests', () => {
    assert.equal(shouldUseNativeThumbnailForIcon('C:\\Users\\73221\\简历.pdf', 'file', 'win32'), false)
    assert.equal(shouldUseNativeThumbnailForIcon('C:\\Program Files\\App\\app.exe', 'app', 'win32'), false)
    assert.equal(shouldUseNativeThumbnailForIcon('/Users/73221/简历.pdf', 'file', 'darwin'), true)
  })
})
