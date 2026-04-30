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
  build?: {
    extraResources?: ElectronBuilderExtraResource[]
  }
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as PackageJson
}

describe('native addon packaging', () => {
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
})
