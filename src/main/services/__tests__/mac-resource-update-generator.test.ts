import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  coerceMacResourceUpdateManifest,
  verifyMacResourceUpdateManifestSignature,
  type MacResourceUpdateManifestUnsigned
} from '../mac-resource-update-manifest'

const require = createRequire(import.meta.url)
const generator = require(path.resolve('scripts/generate-mac-resource-update.cjs')) as {
  UPDATABLE_ROOTS: string[]
  buildCompatibility: (args: Record<string, unknown>, electronVersion: string) => Record<string, unknown>
  parseArgs: (argv: string[]) => Record<string, unknown>
  signManifest: (manifest: MacResourceUpdateManifestUnsigned, privateKeyPem: string) => string
}

describe('mac resource update generator', () => {
  it('includes the updater helper in resource update packages', () => {
    assert.ok(generator.UPDATABLE_ROOTS.includes('updater'))
  })

  it('builds compatibility metadata from release flags', () => {
    const args = generator.parseArgs([
      '--tag',
      'v0.8.3',
      '--min-app-version',
      'v0.8.3',
      '--max-app-version',
      '0.9.0',
      '--requires-manual-install',
      '--manual-install-reason',
      'Manual install required for this bridge release.'
    ])

    assert.equal(args['requires-manual-install'], true)
    assert.deepEqual(generator.buildCompatibility(args, '41.2.0'), {
      protocolVersion: 1,
      appId: 'com.mulby.app',
      electronVersion: '41.2.0',
      minAppVersion: '0.8.3',
      maxAppVersion: '0.9.0',
      requiresManualInstall: true,
      manualInstallReason: 'Manual install required for this bridge release.'
    })
  })

  it('signs manifests with canonical JSON compatible with runtime verification', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
    const unsignedManifest: MacResourceUpdateManifestUnsigned = {
      version: '0.8.3',
      arch: 'x64',
      packageUrl: 'https://example.com/mulby-update-darwin-x64-0.8.3.zip',
      sha256: 'a'.repeat(64),
      size: 123,
      releasePageUrl: 'https://example.com/releases/v0.8.3',
      compatibility: {
        protocolVersion: 1,
        appId: 'com.mulby.app',
        electronVersion: '41.2.0',
        minAppVersion: '0.8.3'
      }
    }

    const manifest = coerceMacResourceUpdateManifest({
      ...unsignedManifest,
      signature: {
        algorithm: 'ed25519',
        value: generator.signManifest(unsignedManifest, privateKeyPem)
      }
    })

    assert.equal(verifyMacResourceUpdateManifestSignature(manifest, publicKeyPem), true)
    assert.equal(manifest.compatibility.minAppVersion, '0.8.3')
  })
})
