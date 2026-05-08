const { execFileSync } = require('child_process')
const { createHash, createPrivateKey, sign } = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '..')
const PACKAGE_JSON = require(path.join(ROOT_DIR, 'package.json'))
const APP_ID = PACKAGE_JSON.build?.appId || 'com.mulby.app'
const PROTOCOL_VERSION = 1
const DEFAULT_RELEASE_REPO = 'Unicellular-SU/mulby-releases'
const UPDATABLE_ROOTS = [
  'app.asar',
  'app.asar.unpacked',
  'internal-plugins',
  'mcp',
  'native/build/Release',
  'resources/tray',
  'bin'
]

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) continue
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`)
    }
    result[key.slice(2)] = value
    index += 1
  }
  return result
}

function canonicalizeValue(input) {
  if (Array.isArray(input)) {
    return input.map((item) => canonicalizeValue(item))
  }
  if (!input || typeof input !== 'object') {
    return input
  }
  const output = {}
  for (const key of Object.keys(input).sort()) {
    const value = input[key]
    if (value === undefined) continue
    output[key] = canonicalizeValue(value)
  }
  return output
}

function canonicalize(input) {
  return JSON.stringify(canonicalizeValue(input))
}

function normalizeVersion(input) {
  return String(input || '').trim().replace(/^v/i, '')
}

function normalizePemSecret(input) {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error('MAC_RESOURCE_UPDATE_PRIVATE_KEY_PEM is required to sign macOS resource update manifests')
  }
  if (raw.includes('-----BEGIN')) {
    return raw.replace(/\\n/g, '\n')
  }
  return Buffer.from(raw, 'base64').toString('utf8')
}

function findAppBundles(rootDir) {
  const result = []
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !fs.existsSync(current)) continue
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name)
      if (!entry.isDirectory()) continue
      if (entry.name.endsWith('.app') && fs.existsSync(path.join(absolutePath, 'Contents', 'Resources'))) {
        result.push(absolutePath)
        continue
      }
      stack.push(absolutePath)
    }
  }
  return result.sort((left, right) => left.localeCompare(right))
}

function detectAppArch(appPath) {
  const appName = path.basename(appPath, '.app')
  const executablePath = path.join(appPath, 'Contents', 'MacOS', appName)
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Cannot find app executable: ${executablePath}`)
  }
  const output = execFileSync('/usr/bin/lipo', ['-archs', executablePath], { encoding: 'utf8' }).trim()
  const archs = output.split(/\s+/).filter(Boolean)
  if (archs.length !== 1) {
    throw new Error(`Expected a single-architecture app for resource updates, got ${archs.join(', ')} at ${appPath}`)
  }
  if (archs[0] === 'x86_64') return 'x64'
  return archs[0]
}

function resolveElectronVersion() {
  try {
    const electronPackage = require(path.join(ROOT_DIR, 'node_modules', 'electron', 'package.json'))
    return normalizeVersion(electronPackage.version)
  } catch {
    return normalizeVersion(PACKAGE_JSON.devDependencies?.electron || '')
  }
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function copyResource(resourcesDir, stagingDir, root) {
  const source = path.join(resourcesDir, root)
  if (!fs.existsSync(source)) return false
  const target = path.join(stagingDir, root)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, {
    recursive: true,
    preserveTimestamps: true,
    force: true,
    errorOnExist: false
  })
  return true
}

function packageResources(appPath, outputZip) {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources')
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mulby-resource-package-'))
  try {
    const copied = UPDATABLE_ROOTS.filter((root) => copyResource(resourcesDir, stagingDir, root))
    if (!copied.includes('app.asar')) {
      throw new Error(`Cannot create resource update without app.asar: ${appPath}`)
    }
    fs.rmSync(outputZip, { force: true })
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--zlibCompressionLevel', '9', stagingDir, outputZip], {
      stdio: 'inherit'
    })
    return copied
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
}

function buildReleaseAssetUrl(repo, tag, assetName) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`
}

function buildReleasePageUrl(repo, tag) {
  return `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`
}

function signManifest(unsignedManifest, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem)
  return sign(null, Buffer.from(canonicalize(unsignedManifest), 'utf8'), privateKey).toString('base64')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const releaseDir = path.resolve(args['release-dir'] || path.join(ROOT_DIR, 'release'))
  const outputDir = path.resolve(args['out-dir'] || releaseDir)
  const version = normalizeVersion(args.version || PACKAGE_JSON.version)
  const tag = args.tag || process.env.GITHUB_REF_NAME || `v${version}`
  const repo = args.repo || process.env.MULBY_RELEASE_REPO || DEFAULT_RELEASE_REPO
  const electronVersion = normalizeVersion(args['electron-version'] || resolveElectronVersion())
  const privateKeyPem = normalizePemSecret(process.env.MAC_RESOURCE_UPDATE_PRIVATE_KEY_PEM)
  const appBundles = args.app ? [path.resolve(args.app)] : findAppBundles(releaseDir)

  if (appBundles.length === 0) {
    throw new Error(`No .app bundles found under ${releaseDir}`)
  }

  fs.mkdirSync(outputDir, { recursive: true })
  const generated = []

  for (const appPath of appBundles) {
    const arch = detectAppArch(appPath)
    const assetName = `mulby-update-darwin-${arch}-${version}.zip`
    const outputZip = path.join(outputDir, assetName)
    const copiedRoots = packageResources(appPath, outputZip)
    const size = fs.statSync(outputZip).size
    const sha256 = sha256File(outputZip)
    const unsignedManifest = {
      version,
      arch,
      packageUrl: buildReleaseAssetUrl(repo, tag, assetName),
      sha256,
      size,
      releasePageUrl: buildReleasePageUrl(repo, tag),
      compatibility: {
        protocolVersion: PROTOCOL_VERSION,
        appId: APP_ID,
        electronVersion
      }
    }
    const manifest = {
      ...unsignedManifest,
      signature: {
        algorithm: 'ed25519',
        value: signManifest(unsignedManifest, privateKeyPem)
      }
    }
    const manifestName = `latest-mac-resource-${arch}.json`
    const manifestPath = path.join(outputDir, manifestName)
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    generated.push({ arch, assetName, manifestName, outputZip, manifestPath, copiedRoots })
    console.log(`[mac-resource-update] Generated ${assetName}, ${manifestName} (${copiedRoots.join(', ')})`)
  }

  const x64Manifest = generated.find((item) => item.arch === 'x64') || generated[0]
  if (x64Manifest) {
    fs.copyFileSync(x64Manifest.manifestPath, path.join(outputDir, 'latest-mac-resource.json'))
    console.log(`[mac-resource-update] Wrote compatibility manifest latest-mac-resource.json from ${x64Manifest.manifestName}`)
  }
}

main()
