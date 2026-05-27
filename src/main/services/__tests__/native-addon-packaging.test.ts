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

function readAfterPackScript(): string {
  return readFileSync(resolve(process.cwd(), 'scripts/electron-builder-after-pack.cjs'), 'utf8')
}

function readMacSigningVerifierScript(): string {
  return readFileSync(resolve(process.cwd(), 'scripts/verify-mac-app-signing.cjs'), 'utf8')
}

function readBuildNativeScript(): string {
  return readFileSync(resolve(process.cwd(), 'scripts/build-native.mjs'), 'utf8')
}

function readViteConfig(): string {
  return readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
}

describe('native addon packaging', () => {
  it('builds app native addons before release publishing', () => {
    const pkg = readPackageJson()
    const releaseWorkflow = readReleaseWorkflow()
    const buildNativeStep = 'pnpm run native:build'
    const publishStep = 'pnpm run electron:publish:prepared'

    assert.equal(pkg.scripts?.['native:build'], 'node scripts/build-native.mjs')
    assert.equal(pkg.scripts?.['electron:publish:prepared'], 'vite build && electron-builder --publish always')
    assert.equal(
      pkg.scripts?.['electron:build:mac:unsigned:prepared'],
      'MULBY_MAC_UNSIGNED_RESOURCE_UPDATES=true vite build && electron-builder --mac --publish never'
    )
    assert.ok(!pkg.scripts?.['electron:publish:prepared']?.includes('native:build'))
    assert.ok(!pkg.scripts?.['electron:build:mac:unsigned:prepared']?.includes('native:build'))
    assert.match(releaseWorkflow, new RegExp(buildNativeStep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.ok(
      releaseWorkflow.indexOf(buildNativeStep) < releaseWorkflow.indexOf(publishStep),
      'release workflow must build native addons before prepared publishing'
    )
  })

  it('forces macOS unsigned builds onto the resource update route', () => {
    const pkg = readPackageJson()
    const releaseWorkflow = readReleaseWorkflow()
    const macUnsignedScript = pkg.scripts?.['electron:build:mac:unsigned'] || ''
    const preparedMacUnsignedScript = pkg.scripts?.['electron:build:mac:unsigned:prepared'] || ''

    assert.match(macUnsignedScript, /MULBY_MAC_UNSIGNED_RESOURCE_UPDATES=true vite build/)
    assert.match(preparedMacUnsignedScript, /MULBY_MAC_UNSIGNED_RESOURCE_UPDATES=true vite build/)
    assert.match(releaseWorkflow, /MULBY_MAC_UNSIGNED_RESOURCE_UPDATES:\s*"true"/)
  })

  it('injects macOS resource update defines into Electron child builds', () => {
    const viteConfig = readViteConfig()
    const defineUsages = viteConfig.match(/define:\s*buildDefines/g) || []

    assert.match(viteConfig, /__MULBY_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM__/)
    assert.match(viteConfig, /__MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__/)
    assert.ok(
      defineUsages.length >= 11,
      'Vite defines must be applied to the renderer and every vite-plugin-electron child build'
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

  it('prunes unsupported sharp optional native packages from macOS app bundles', () => {
    const afterPackScript = readAfterPackScript()
    const verifierScript = readMacSigningVerifierScript()

    assert.match(afterPackScript, /pruneUnsupportedSharpOptionalPackages\(unpackedDir\)/)
    assert.match(afterPackScript, /assertNoUnsupportedSharpOptionalPackages\(unpackedDir\)/)
    assert.match(afterPackScript, /sharp-darwin-arm64/)
    assert.match(afterPackScript, /sharp-darwin-x64/)
    assert.match(afterPackScript, /sharp-libvips-darwin-arm64/)
    assert.match(afterPackScript, /sharp-libvips-darwin-x64/)

    assert.match(verifierScript, /Unsupported sharp optional packages in macOS app bundle/)
  })

  it('builds macOS project native addons as universal binaries and verifies packaged architectures', () => {
    const buildNativeScript = readBuildNativeScript()
    const afterPackScript = readAfterPackScript()
    const verifierScript = readMacSigningVerifierScript()

    assert.match(buildNativeScript, /--arch=\$\{arch\}/)
    assert.match(buildNativeScript, /'x64', 'arm64'/)
    assert.match(buildNativeScript, /lipo/)

    assert.match(afterPackScript, /assertNativeModuleArchitectures\(appPath, nativeNodes\)/)
    assert.match(verifierScript, /assertNativeModuleArchitectures\(appPath, extraResourceNativeModules\)/)
  })
})
