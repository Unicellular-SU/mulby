import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import {
  coerceMacResourceUpdateManifest,
  DEFAULT_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM,
  evaluateMacResourceUpdateCompatibility,
  MAC_RESOURCE_UPDATE_PROTOCOL_VERSION,
  MULBY_APP_ID,
  type MacResourceCompatibilityResult,
  type MacResourceUpdateManifest,
  verifyMacResourceUpdateManifestSignature
} from './mac-resource-update-manifest'

declare const __MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__: boolean | undefined

const DEFAULT_MAC_RESOURCE_UPDATE_BASE_URL = 'https://github.com/Unicellular-SU/mulby-releases/releases/latest/download'
const BUILD_MAC_UNSIGNED_RESOURCE_UPDATES = typeof __MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__ === 'boolean'
  ? __MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__
  : false

export interface MacResourceManifestFetchResult {
  manifest: MacResourceUpdateManifest
  manifestUrl: string
  compatibility: MacResourceCompatibilityResult
}

export interface MacResourceDownloadProgress {
  bytesPerSecond: number
  percent: number
  transferred: number
  total: number
}

function safeString(input: unknown): string {
  return String(input || '').trim()
}

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, '')
}

function isHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function isMacResourceUpdateRuntime(): boolean {
  return process.platform === 'darwin' && app.isPackaged && BUILD_MAC_UNSIGNED_RESOURCE_UPDATES
}

export function resolveMacResourceManifestUrls(arch: NodeJS.Architecture = process.arch): string[] {
  const explicitUrl = safeString(process.env['MULBY_MAC_RESOURCE_UPDATE_MANIFEST_URL'])
  if (explicitUrl) {
    return [explicitUrl]
  }

  const baseUrl = normalizeBaseUrl(safeString(process.env['MULBY_MAC_RESOURCE_UPDATE_BASE_URL']) || DEFAULT_MAC_RESOURCE_UPDATE_BASE_URL)
  return [
    `${baseUrl}/latest-mac-resource-${arch}.json`,
    `${baseUrl}/latest-mac-resource.json`
  ]
}

export function resolveMacResourcePublicKeyPem(): string {
  const fromEnv = safeString(process.env['MULBY_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM']).replace(/\\n/g, '\n')
  return fromEnv || DEFAULT_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM
}

export async function fetchMacResourceUpdateManifest(currentVersion: string): Promise<MacResourceManifestFetchResult> {
  const manifestUrls = resolveMacResourceManifestUrls()
  let lastError: Error | null = null

  for (const manifestUrl of manifestUrls) {
    if (!isHttpUrl(manifestUrl)) {
      lastError = new Error('macOS 资源更新源未配置或格式无效')
      continue
    }

    try {
      const response = await fetch(manifestUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': `Mulby/${currentVersion}`
        },
        cache: 'no-store'
      })

      if (response.status === 404 && manifestUrls.length > 1) {
        lastError = new Error(`资源更新 manifest 不存在（HTTP 404）：${manifestUrl}`)
        continue
      }
      if (!response.ok) {
        throw new Error(`资源更新检查失败（HTTP ${response.status}）`)
      }

      const manifest = coerceMacResourceUpdateManifest(await response.json())
      if (!verifyMacResourceUpdateManifestSignature(manifest, resolveMacResourcePublicKeyPem())) {
        throw new Error('资源更新 manifest 签名校验失败')
      }

      const compatibility = evaluateMacResourceUpdateCompatibility(manifest, {
        currentVersion,
        currentArch: process.arch,
        electronVersion: process.versions.electron || '',
        appId: MULBY_APP_ID,
        supportedProtocolVersion: MAC_RESOURCE_UPDATE_PROTOCOL_VERSION
      })

      return { manifest, manifestUrl, compatibility }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('资源更新检查失败')
    }
  }

  throw lastError || new Error('资源更新检查失败')
}

export async function downloadMacResourceUpdatePackage(
  manifest: MacResourceUpdateManifest,
  onProgress: (progress: MacResourceDownloadProgress) => void
): Promise<string> {
  if (!isHttpUrl(manifest.packageUrl)) {
    throw new Error('资源更新包地址无效')
  }

  const response = await fetch(manifest.packageUrl, {
    method: 'GET',
    headers: {
      'User-Agent': `Mulby/${app.getVersion()}`
    },
    cache: 'no-store'
  })

  if (!response.ok) {
    throw new Error(`资源更新包下载失败（HTTP ${response.status}）`)
  }
  if (!response.body) {
    throw new Error('资源更新包响应为空')
  }

  const updateDir = path.join(app.getPath('userData'), 'updates', 'mac-resource')
  await mkdir(updateDir, { recursive: true })

  const assetName = path.basename(new URL(manifest.packageUrl).pathname) || `mulby-update-darwin-${manifest.arch}-${manifest.version}.zip`
  const packagePath = path.join(updateDir, assetName)
  const tempPath = `${packagePath}.download`
  await unlink(tempPath).catch(() => {})

  const total = manifest.size || Number(response.headers.get('content-length')) || 0
  const startedAt = Date.now()
  let transferred = 0
  let lastProgressAt = 0
  const sha256 = createHash('sha256')
  const file = createWriteStream(tempPath)
  const source = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0])

  try {
    for await (const chunk of source) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array)
      sha256.update(buffer)
      transferred += buffer.byteLength

      if (!file.write(buffer)) {
        await once(file, 'drain')
      }

      const now = Date.now()
      if (now - lastProgressAt >= 250) {
        lastProgressAt = now
        const elapsedSeconds = Math.max(0.001, (now - startedAt) / 1000)
        onProgress({
          bytesPerSecond: Math.round(transferred / elapsedSeconds),
          percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
          transferred,
          total
        })
      }
    }

    file.end()
    await finished(file)
  } catch (error) {
    file.destroy()
    await unlink(tempPath).catch(() => {})
    throw error
  }

  const actualSha256 = sha256.digest('hex')
  if (actualSha256 !== manifest.sha256.toLowerCase()) {
    await unlink(tempPath).catch(() => {})
    throw new Error('资源更新包 sha256 校验失败')
  }
  if (manifest.size > 0 && transferred !== manifest.size) {
    await unlink(tempPath).catch(() => {})
    throw new Error('资源更新包大小校验失败')
  }

  await rename(tempPath, packagePath)
  onProgress({
    bytesPerSecond: Math.round(transferred / Math.max(0.001, (Date.now() - startedAt) / 1000)),
    percent: 100,
    transferred,
    total: total || transferred
  })
  return packagePath
}

function resolveCurrentMacAppPath(): string {
  const marker = '.app/Contents/MacOS/'
  const markerIndex = process.execPath.indexOf(marker)
  if (markerIndex < 0) {
    throw new Error('无法定位当前 Mulby.app 路径')
  }
  return process.execPath.slice(0, markerIndex + '.app'.length)
}

export function installMacResourceUpdatePackage(manifest: MacResourceUpdateManifest, packagePath: string): void {
  const helperPath = path.join(process.resourcesPath, 'updater', 'mulby-mac-resource-updater.cjs')
  if (!existsSync(helperPath)) {
    throw new Error(`macOS 资源更新 helper 不存在：${helperPath}`)
  }
  if (!existsSync(packagePath)) {
    throw new Error(`资源更新包不存在：${packagePath}`)
  }

  const appPath = resolveCurrentMacAppPath()
  const child = spawn(process.execPath, [
    helperPath,
    '--package',
    packagePath,
    '--app',
    appPath,
    '--pid',
    String(process.pid),
    '--version',
    manifest.version,
    '--user-data',
    app.getPath('userData')
  ], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    }
  })

  child.unref()
  app.quit()
}
