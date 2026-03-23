/**
 * OpenClaw 设备身份管理
 *
 * 管理 Ed25519 密钥对（持久化到 userData），用于 Gateway Protocol 握手签名。
 * 密钥对在首次创建后持久化，确保 device.id（公钥指纹）在重启后保持不变。
 *
 * 实现参考: openclaw/apps/android DeviceIdentityStore.kt + DeviceAuthPayload.kt
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto'

// ==================== 路径 ====================

function getKeyDir(): string {
  return join(app.getPath('userData'), 'openclaw')
}

function getPrivateKeyPath(): string {
  return join(getKeyDir(), 'device.key')
}

function getPublicKeyPath(): string {
  return join(getKeyDir(), 'device.pub')
}

// ==================== 类型 ====================

export interface DeviceIdentity {
  /** 设备 ID = SHA-256(rawPublicKey).hex（完整 64 字符） */
  id: string
  /** Ed25519 公钥（base64url，无 padding） */
  publicKey: string
}

// ==================== 缓存 ====================

let cachedIdentity: DeviceIdentity | null = null
let cachedPrivateKeyPem: string | null = null

// ==================== 公开 API ====================

/**
 * 获取或创建设备身份（Ed25519 密钥对）
 * 首次调用时生成并持久化，后续调用从缓存/文件读取
 */
export function getDeviceIdentity(): DeviceIdentity {
  if (cachedIdentity) return cachedIdentity

  try {
    const privPem = readFileSync(getPrivateKeyPath(), 'utf8')
    const pubPem = readFileSync(getPublicKeyPath(), 'utf8')
    cachedPrivateKeyPem = privPem
    const rawKey = extractRawPublicKey(pubPem)
    cachedIdentity = {
      id: sha256Hex(rawKey),
      publicKey: base64UrlEncode(rawKey)
    }
    return cachedIdentity
  } catch {
    return generateAndSaveKeyPair()
  }
}

/**
 * 对 connect.challenge nonce 进行签名
 *
 * 签名 payload 格式（v3，与 Android/iOS/CLI 保持一致）:
 * `v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|authToken|nonce|platform|deviceFamily`
 *
 * 参考: DeviceAuthPayload.kt#buildV3
 */
export function signChallenge(params: {
  nonce: string
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  token: string
  platform: string
  deviceFamily: string
}): { signature: string; signedAt: number } {
  if (!cachedPrivateKeyPem) {
    getDeviceIdentity()
  }

  const signedAt = Date.now()

  // 构建 v3 payload（pipe 分隔），与 Android DeviceAuthPayload.buildV3 一致
  const scopeString = params.scopes.join(',')
  const authToken = params.token || ''
  const platformNorm = normalizeMetadataField(params.platform)
  const deviceFamilyNorm = normalizeMetadataField(params.deviceFamily)

  const payload = [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopeString,
    signedAt.toString(),
    authToken,
    params.nonce,
    platformNorm,
    deviceFamilyNorm
  ].join('|')

  const privateKey = createPrivateKey(cachedPrivateKeyPem!)
  const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey)

  return {
    signature: base64UrlEncode(sig),
    signedAt
  }
}

// ==================== 内部工具 ====================

/** 生成新密钥对并持久化 */
function generateAndSaveKeyPair(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

  try {
    mkdirSync(getKeyDir(), { recursive: true })
  } catch {
    // 目录已存在
  }

  writeFileSync(getPrivateKeyPath(), privateKey, { mode: 0o600 })
  writeFileSync(getPublicKeyPath(), publicKey, { mode: 0o644 })

  cachedPrivateKeyPem = privateKey
  const rawKey = extractRawPublicKey(publicKey)
  cachedIdentity = {
    id: sha256Hex(rawKey),
    publicKey: base64UrlEncode(rawKey)
  }
  return cachedIdentity
}

/** 从 PEM 提取原始 32 字节 Ed25519 公钥 */
function extractRawPublicKey(pubPem: string): Buffer {
  const derB64 = pubPem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '')
  const der = Buffer.from(derB64, 'base64')
  // Ed25519 SPKI DER: 前 12 字节是 ASN.1 头，后 32 字节是原始公钥
  return der.subarray(der.length - 32)
}

/** SHA-256 hex（完整 64 字符），与 Android sha256Hex 一致 */
function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Base64url 编码（无 padding），与 Android base64UrlEncode 一致 */
function base64UrlEncode(data: Buffer): string {
  return data.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * 规范化 metadata 字段（ASCII 小写），与 Android normalizeMetadataField 一致。
 * 仅将 A-Z 转为 a-z，其他字符保持不变。
 */
function normalizeMetadataField(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  let out = ''
  for (const ch of trimmed) {
    const code = ch.charCodeAt(0)
    if (code >= 65 && code <= 90) { // A-Z
      out += String.fromCharCode(code + 32)
    } else {
      out += ch
    }
  }
  return out
}
