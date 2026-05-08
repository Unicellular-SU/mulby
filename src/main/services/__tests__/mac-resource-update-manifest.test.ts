import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  canonicalizeMacResourceManifestForSigning,
  evaluateMacResourceUpdateCompatibility,
  MAC_RESOURCE_UPDATE_PROTOCOL_VERSION,
  MULBY_APP_ID,
  type MacResourceUpdateManifest,
  type MacResourceUpdateManifestUnsigned,
  verifyMacResourceUpdateManifestSignature
} from '../mac-resource-update-manifest'

function signedManifest(overrides: Partial<MacResourceUpdateManifestUnsigned> = {}) {
  const keyPair = generateKeyPairSync('ed25519')
  const unsigned: MacResourceUpdateManifestUnsigned = {
    version: '1.2.0',
    arch: 'x64',
    packageUrl: 'https://example.com/mulby-update-darwin-x64-1.2.0.zip',
    sha256: 'a'.repeat(64),
    size: 1024,
    releasePageUrl: 'https://example.com/releases/tag/v1.2.0',
    compatibility: {
      protocolVersion: MAC_RESOURCE_UPDATE_PROTOCOL_VERSION,
      appId: MULBY_APP_ID,
      electronVersion: '41.1.0'
    },
    ...overrides
  }
  const signature = sign(
    null,
    Buffer.from(canonicalizeMacResourceManifestForSigning(unsigned), 'utf8'),
    keyPair.privateKey
  ).toString('base64')
  const manifest: MacResourceUpdateManifest = {
    ...unsigned,
    signature: {
      algorithm: 'ed25519',
      value: signature
    }
  }
  const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return { manifest, publicKeyPem }
}

describe('mac resource update manifest', () => {
  it('verifies Ed25519 signatures and rejects tampered manifests', () => {
    const { manifest, publicKeyPem } = signedManifest()

    assert.equal(verifyMacResourceUpdateManifestSignature(manifest, publicKeyPem), true)
    assert.equal(verifyMacResourceUpdateManifestSignature({ ...manifest, version: '1.2.1' }, publicKeyPem), false)
    assert.equal(verifyMacResourceUpdateManifestSignature({ ...manifest, packageUrl: 'https://example.com/other.zip' }, publicKeyPem), false)
    assert.equal(verifyMacResourceUpdateManifestSignature({ ...manifest, sha256: 'b'.repeat(64) }, publicKeyPem), false)
  })

  it('allows compatible resource updates', () => {
    const { manifest } = signedManifest()
    const result = evaluateMacResourceUpdateCompatibility(manifest, {
      currentVersion: '1.1.0',
      currentArch: 'x64',
      electronVersion: '41.1.0',
      appId: MULBY_APP_ID
    })

    assert.equal(result.installMode, 'resource')
    assert.equal(result.manualInstallReason, undefined)
  })

  it('falls back to manual install for incompatible structural fields', () => {
    const { manifest } = signedManifest()

    assert.equal(evaluateMacResourceUpdateCompatibility({ ...manifest, arch: 'arm64' }, {
      currentVersion: '1.1.0',
      currentArch: 'x64',
      electronVersion: '41.1.0',
      appId: MULBY_APP_ID
    }).installMode, 'manual')

    assert.equal(evaluateMacResourceUpdateCompatibility({
      ...manifest,
      compatibility: { ...manifest.compatibility, electronVersion: '42.0.0' }
    }, {
      currentVersion: '1.1.0',
      currentArch: 'x64',
      electronVersion: '41.1.0',
      appId: MULBY_APP_ID
    }).installMode, 'manual')

    assert.equal(evaluateMacResourceUpdateCompatibility({
      ...manifest,
      compatibility: { ...manifest.compatibility, protocolVersion: 999 }
    }, {
      currentVersion: '1.1.0',
      currentArch: 'x64',
      electronVersion: '41.1.0',
      appId: MULBY_APP_ID
    }).installMode, 'manual')
  })
})
