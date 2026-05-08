import { createPublicKey, verify as verifySignature } from 'node:crypto'
import { compareVersions } from '../plugin/version'

declare const __MULBY_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM__: string | undefined

export const MAC_RESOURCE_UPDATE_PROTOCOL_VERSION = 1
export const MULBY_APP_ID = 'com.mulby.app'

const FALLBACK_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAk/5BjgiNlZVX9rU6Ihscm51j56khtW6GMRFEUmmEZME=',
  '-----END PUBLIC KEY-----'
].join('\n')

export const DEFAULT_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM = (
  typeof __MULBY_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM__ === 'string' && __MULBY_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM__.trim()
    ? __MULBY_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM__
    : FALLBACK_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM
).replace(/\\n/g, '\n')

export interface MacResourceUpdateCompatibility {
  protocolVersion: number
  appId: string
  electronVersion: string
  minAppVersion?: string
  maxAppVersion?: string
  requiresManualInstall?: boolean
  manualInstallReason?: string
}

export interface MacResourceUpdateSignature {
  algorithm: 'ed25519'
  value: string
}

export interface MacResourceUpdateManifest {
  version: string
  arch: NodeJS.Architecture
  packageUrl: string
  sha256: string
  size: number
  releasePageUrl: string
  compatibility: MacResourceUpdateCompatibility
  signature: MacResourceUpdateSignature
}

export type MacResourceUpdateManifestUnsigned = Omit<MacResourceUpdateManifest, 'signature'>

export interface MacResourceCompatibilityContext {
  currentVersion: string
  currentArch: NodeJS.Architecture
  electronVersion: string
  appId?: string
  supportedProtocolVersion?: number
}

export interface MacResourceCompatibilityResult {
  installMode: 'resource' | 'manual'
  manualInstallReason?: string
}

function normalizeVersion(input: string): string {
  return String(input || '').trim().replace(/^v/i, '')
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`mac resource update manifest is missing ${key}`)
  }
  return value.trim()
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`mac resource update manifest field ${key} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`mac resource update manifest is missing numeric ${key}`)
  }
  return value
}

function canonicalizeValue(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => canonicalizeValue(item))
  }
  if (!isPlainObject(input)) {
    return input
  }

  const output: Record<string, unknown> = {}
  for (const key of Object.keys(input).sort()) {
    const value = input[key]
    if (value === undefined) continue
    output[key] = canonicalizeValue(value)
  }
  return output
}

export function canonicalizeMacResourceManifestForSigning(manifest: MacResourceUpdateManifestUnsigned): string {
  return JSON.stringify(canonicalizeValue(manifest))
}

export function unsignedMacResourceManifest(manifest: MacResourceUpdateManifest): MacResourceUpdateManifestUnsigned {
  return {
    version: manifest.version,
    arch: manifest.arch,
    packageUrl: manifest.packageUrl,
    sha256: manifest.sha256,
    size: manifest.size,
    releasePageUrl: manifest.releasePageUrl,
    compatibility: manifest.compatibility
  }
}

export function coerceMacResourceUpdateManifest(input: unknown): MacResourceUpdateManifest {
  if (!isPlainObject(input)) {
    throw new Error('mac resource update manifest must be an object')
  }

  const compatibilityInput = input['compatibility']
  if (!isPlainObject(compatibilityInput)) {
    throw new Error('mac resource update manifest is missing compatibility')
  }

  const signatureInput = input['signature']
  if (!isPlainObject(signatureInput)) {
    throw new Error('mac resource update manifest is missing signature')
  }

  const algorithm = requiredString(signatureInput, 'algorithm')
  if (algorithm !== 'ed25519') {
    throw new Error(`unsupported mac resource update signature algorithm: ${algorithm}`)
  }

  return {
    version: normalizeVersion(requiredString(input, 'version')),
    arch: requiredString(input, 'arch') as NodeJS.Architecture,
    packageUrl: requiredString(input, 'packageUrl'),
    sha256: requiredString(input, 'sha256').toLowerCase(),
    size: requiredNumber(input, 'size'),
    releasePageUrl: requiredString(input, 'releasePageUrl'),
    compatibility: {
      protocolVersion: requiredNumber(compatibilityInput, 'protocolVersion'),
      appId: requiredString(compatibilityInput, 'appId'),
      electronVersion: normalizeVersion(requiredString(compatibilityInput, 'electronVersion')),
      minAppVersion: optionalString(compatibilityInput, 'minAppVersion'),
      maxAppVersion: optionalString(compatibilityInput, 'maxAppVersion'),
      requiresManualInstall: compatibilityInput['requiresManualInstall'] === true ? true : undefined,
      manualInstallReason: optionalString(compatibilityInput, 'manualInstallReason')
    },
    signature: {
      algorithm,
      value: requiredString(signatureInput, 'value')
    }
  }
}

export function verifyMacResourceUpdateManifestSignature(
  manifest: MacResourceUpdateManifest,
  publicKeyPem = DEFAULT_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM
): boolean {
  if (manifest.signature.algorithm !== 'ed25519') {
    return false
  }

  try {
    const publicKey = createPublicKey(publicKeyPem)
    const canonical = canonicalizeMacResourceManifestForSigning(unsignedMacResourceManifest(manifest))
    return verifySignature(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(manifest.signature.value, 'base64'))
  } catch {
    return false
  }
}

export function evaluateMacResourceUpdateCompatibility(
  manifest: MacResourceUpdateManifest,
  context: MacResourceCompatibilityContext
): MacResourceCompatibilityResult {
  const expectedProtocol = context.supportedProtocolVersion ?? MAC_RESOURCE_UPDATE_PROTOCOL_VERSION
  const expectedAppId = context.appId ?? MULBY_APP_ID

  if (manifest.compatibility.requiresManualInstall) {
    return {
      installMode: 'manual',
      manualInstallReason: manifest.compatibility.manualInstallReason || '此版本需要手动安装完整安装包。'
    }
  }

  if (manifest.arch !== context.currentArch) {
    return {
      installMode: 'manual',
      manualInstallReason: `此版本面向 ${manifest.arch} 架构，当前应用为 ${context.currentArch}，需要手动下载安装包。`
    }
  }

  if (manifest.compatibility.protocolVersion !== expectedProtocol) {
    return {
      installMode: 'manual',
      manualInstallReason: '资源更新协议版本不兼容，需要手动安装完整安装包。'
    }
  }

  if (manifest.compatibility.appId !== expectedAppId) {
    return {
      installMode: 'manual',
      manualInstallReason: '更新包与当前应用标识不匹配，需要手动安装完整安装包。'
    }
  }

  if (normalizeVersion(manifest.compatibility.electronVersion) !== normalizeVersion(context.electronVersion)) {
    return {
      installMode: 'manual',
      manualInstallReason: '此版本包含 Electron 或原生运行时变更，需要手动安装完整安装包。'
    }
  }

  const currentVersion = normalizeVersion(context.currentVersion)
  const minAppVersion = manifest.compatibility.minAppVersion ? normalizeVersion(manifest.compatibility.minAppVersion) : undefined
  const maxAppVersion = manifest.compatibility.maxAppVersion ? normalizeVersion(manifest.compatibility.maxAppVersion) : undefined
  if (minAppVersion && compareVersions(currentVersion, minAppVersion) < 0) {
    return {
      installMode: 'manual',
      manualInstallReason: `当前版本低于资源更新最低要求 ${minAppVersion}，需要手动安装完整安装包。`
    }
  }
  if (maxAppVersion && compareVersions(currentVersion, maxAppVersion) > 0) {
    return {
      installMode: 'manual',
      manualInstallReason: `当前版本高于资源更新最高支持版本 ${maxAppVersion}，需要手动安装完整安装包。`
    }
  }

  return { installMode: 'resource' }
}
