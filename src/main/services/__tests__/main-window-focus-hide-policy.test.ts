import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const mainWindowManagerSourcePath = join(process.cwd(), 'src/main/main-window-manager.ts')

describe('main window focus and blur-hide policy', () => {
  it('defers blur-hide checks that happen during blur suppression instead of dropping them', () => {
    const source = readFileSync(mainWindowManagerSourcePath, 'utf8')

    assert.match(
      source,
      /private pendingBlurHideAfterSuppression = false/,
      'main window manager should remember a blur that was swallowed by suppression'
    )
    assert.match(
      source,
      /private blurSuppressionFlushTimer: NodeJS\.Timeout \| null = null/,
      'main window manager should own a timer for flushing suppressed blur checks'
    )
    assert.match(
      source,
      /private deferBlurHideUntilSuppressionEnds\(\): void \{[\s\S]*this\.pendingBlurHideAfterSuppression = true[\s\S]*setTimeout\(/,
      'suppressed blur should be scheduled for a later focus re-check'
    )
    assert.match(
      source,
      /win\.on\('blur', \(\) => \{[\s\S]*this\.deferBlurHideUntilSuppressionEnds\(\)[\s\S]*return[\s\S]*this\.scheduleBlurHideCheck\(\)/,
      'the blur handler should defer while suppressed and otherwise schedule the normal hide check'
    )
    assert.match(
      source,
      /if \(!this\.pendingBlurHideAfterSuppression\) return[\s\S]*this\.pendingBlurHideAfterSuppression = false[\s\S]*this\.scheduleBlurHideCheck\(\)/,
      'the suppression flush should re-run the normal hide check after suppression ends'
    )
  })

  it('routes every surface blur through one app-level watchdog with a visibility guard', () => {
    const source = readFileSync(mainWindowManagerSourcePath, 'utf8')

    assert.match(
      source,
      /notifySurfaceBlur\(\): void \{[\s\S]*this\.deferBlurHideUntilSuppressionEnds\(\)[\s\S]*return[\s\S]*this\.scheduleBlurHideCheck\(\)/,
      'a single notifySurfaceBlur entry should defer while suppressed and otherwise schedule the hide check'
    )
    assert.match(
      source,
      /app\.on\('browser-window-blur', this\.handleAppBlur\)/,
      'main window manager should install an app-level browser-window-blur watchdog'
    )
    assert.match(
      source,
      /private isMainSurfaceVisible\(\): boolean \{/,
      'main window manager should expose a main-surface visibility check'
    )
    assert.match(
      source,
      /if \(!this\.isMainSurfaceVisible\(\)\) return[\s\S]*if \(this\.isMainSurfaceFocused\(\)\) return[\s\S]*this\.hide\(\)/,
      'the hide check should skip when no surface is visible and only hide once focus has truly left'
    )
  })

  it('retries focus after showing the main window and clears focus timers during teardown', () => {
    const source = readFileSync(mainWindowManagerSourcePath, 'utf8')

    assert.match(
      source,
      /export const MW_POST_SHOW_FOCUS_RETRY_MS = 80/,
      'main window manager should define the first post-show focus retry delay'
    )
    assert.match(
      source,
      /export const MW_POST_SHOW_FOCUS_VERIFY_MS = 180/,
      'main window manager should define the post-retry focus verification delay'
    )
    assert.match(
      source,
      /private postShowFocusRetryTimer: NodeJS\.Timeout \| null = null/,
      'main window manager should own a post-show focus retry timer'
    )
    assert.match(
      source,
      /private schedulePostShowFocusRetry\(\): void \{[\s\S]*setTimeout\(\(\) => \{[\s\S]*this\.window\.webContents\.focus\(\)[\s\S]*log\.warn/,
      'show() should schedule a focus retry and warn if focus still fails'
    )
    assert.match(
      source,
      /this\.window\.webContents\.send\('app:mainWindowShow'[\s\S]*this\.schedulePostShowFocusRetry\(\)/,
      'show() should schedule the focus retry after notifying the renderer that the main window is visible'
    )
    assert.match(
      source,
      /private clearPostShowFocusRetryTimer\(\): void \{[\s\S]*clearTimeout\(this\.postShowFocusRetryTimer\)/,
      'main window manager should centralize post-show focus retry timer cleanup'
    )
    assert.match(
      source,
      /private clearBlurSuppressionFlushTimer\(\): void \{[\s\S]*clearTimeout\(this\.blurSuppressionFlushTimer\)/,
      'main window manager should centralize suppressed blur flush timer cleanup'
    )
  })
})
