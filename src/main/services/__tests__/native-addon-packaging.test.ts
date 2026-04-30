import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

interface ElectronBuilderExtraResource {
  from?: string
  to?: string
  filter?: string[]
}

interface PackageJson {
  scripts?: Record<string, string>
  build?: {
    extraResources?: ElectronBuilderExtraResource[]
  }
}

function readReleaseWorkflow(): string {
  return readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8')
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as PackageJson
}

describe('native addon packaging', () => {
  it('builds app native addons before release publishing', () => {
    const pkg = readPackageJson()
    const releaseWorkflow = readReleaseWorkflow()
    const buildNativeStep = 'pnpm run native:build'
    const publishStep = 'pnpm run electron:publish'

    assert.equal(pkg.scripts?.['native:build'], 'node scripts/build-native.mjs')
    assert.match(releaseWorkflow, new RegExp(buildNativeStep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.ok(
      releaseWorkflow.indexOf(buildNativeStep) < releaseWorkflow.indexOf(publishStep),
      'release workflow must build native addons before electron:publish'
    )
  })

  it('copies native build addons into runtime extraResources', () => {
    const pkg = readPackageJson()
    const extraResources = pkg.build?.extraResources || []

    const nativeAddonResource = extraResources.find((resource) =>
      resource.from === 'native/build/Release' &&
      resource.to === 'native/build/Release'
    )

    assert.ok(nativeAddonResource, 'native/build/Release must be copied as extraResources')
    assert.ok(nativeAddonResource.filter?.includes('*.node'), 'native addon resource must include *.node files')
  })

  it('copies Windows text selection native helper into runtime extraResources', () => {
    const pkg = readPackageJson()
    const extraResources = pkg.build?.extraResources || []

    const textSelectionResource = extraResources.find((resource) =>
      resource.from === 'native/win32-text-selection/build/Release/text_selection.dll' &&
      resource.to === 'native/win32-text-selection/text_selection.dll'
    )

    assert.ok(textSelectionResource, 'Windows text_selection.dll must be copied as extraResources')
  })
})
