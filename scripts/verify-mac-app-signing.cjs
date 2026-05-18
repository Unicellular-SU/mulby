#!/usr/bin/env node

const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '..')
const SUPPORTED_DARWIN_SHARP_PACKAGES = new Set([
  'sharp-darwin-arm64',
  'sharp-darwin-x64',
  'sharp-libvips-darwin-arm64',
  'sharp-libvips-darwin-x64'
])

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe'
  })
}

function runCombined(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}\n${result.stderr || result.stdout}`)
  }

  return `${result.stdout || ''}${result.stderr || ''}`
}

function findAppBundles(rootDir) {
  const result = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !fs.existsSync(current)) continue

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (!entry.isDirectory()) continue

      if (entry.name.endsWith('.app') && fs.existsSync(path.join(fullPath, 'Contents', 'Resources'))) {
        result.push(fullPath)
        continue
      }

      stack.push(fullPath)
    }
  }

  return result.sort((left, right) => left.localeCompare(right))
}

function collectFiles(rootDir) {
  const result = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !fs.existsSync(current)) continue

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        result.push(fullPath)
      }
    }
  }

  return result
}

function isMachOFile(filePath) {
  try {
    const output = run('/usr/bin/file', ['-b', filePath])
    return output.includes('Mach-O')
  } catch {
    return false
  }
}

function getMachOArchs(filePath) {
  try {
    return run('/usr/bin/lipo', ['-archs', filePath]).trim().split(/\s+/).filter(Boolean)
  } catch (error) {
    throw new Error(`Failed to read Mach-O architectures for ${filePath}: ${error.message}`)
  }
}

function verifyCodeSignature(targetPath) {
  run('/usr/bin/codesign', [
    '--verify',
    '--strict',
    '--verbose=2',
    targetPath
  ], { stdio: 'inherit' })
}

function assertNativeModuleArchitectures(appPath, nativeModulePaths) {
  const appName = path.basename(appPath, '.app')
  const executablePath = path.join(appPath, 'Contents', 'MacOS', appName)
  const appArchs = getMachOArchs(executablePath)

  for (const nativeModulePath of nativeModulePaths) {
    const nativeArchs = getMachOArchs(nativeModulePath)
    const missingArchs = appArchs.filter((arch) => !nativeArchs.includes(arch))
    if (missingArchs.length === 0) continue
    throw new Error(
      `Native module architecture mismatch: ${nativeModulePath} has [${nativeArchs.join(', ')}], ` +
      `but ${appName} requires [${appArchs.join(', ')}]`
    )
  }
}

function assertNoUnsupportedSharpOptionalPackages(resourcesDir) {
  const imgDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@img')
  if (!fs.existsSync(imgDir)) return

  const unsupported = fs.readdirSync(imgDir)
    .filter((name) => name.startsWith('sharp-') || name.startsWith('sharp-libvips-'))
    .filter((name) => !SUPPORTED_DARWIN_SHARP_PACKAGES.has(name))
    .sort((left, right) => left.localeCompare(right))

  if (unsupported.length > 0) {
    throw new Error(`Unsupported sharp optional packages in macOS app bundle: ${unsupported.join(', ')}`)
  }
}

function verifyAppBundle(appPath) {
  console.log(`[verify-mac-signing] Verifying ${appPath}`)
  run('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    appPath
  ], { stdio: 'inherit' })

  const appName = path.basename(appPath, '.app')
  const mainExecutable = path.join(appPath, 'Contents', 'MacOS', appName)
  if (!fs.existsSync(mainExecutable)) {
    throw new Error(`Main executable not found: ${mainExecutable}`)
  }
  verifyCodeSignature(mainExecutable)

  const resourcesDir = path.join(appPath, 'Contents', 'Resources')
  assertNoUnsupportedSharpOptionalPackages(resourcesDir)

  const nativeDirs = [
    path.join(resourcesDir, 'native', 'build', 'Release'),
    path.join(resourcesDir, 'app.asar.unpacked')
  ].filter((dirPath) => fs.existsSync(dirPath))

  const nativeCodeObjects = []
  for (const nativeDir of nativeDirs) {
    const files = collectFiles(nativeDir)
    for (const filePath of files) {
      if (filePath.endsWith('.node') || filePath.endsWith('.dylib') || isMachOFile(filePath)) {
        nativeCodeObjects.push(filePath)
      }
    }
  }

  const inputMonitorCandidates = [
    path.join(resourcesDir, 'native', 'build', 'Release', 'input_monitor.node'),
    path.join(resourcesDir, 'app.asar.unpacked', 'native', 'build', 'Release', 'input_monitor.node')
  ]
  if (!inputMonitorCandidates.some((candidate) => fs.existsSync(candidate))) {
    throw new Error(`input_monitor.node not found in packaged resources for ${appPath}`)
  }

  const extraResourceNativeDir = path.join(resourcesDir, 'native', 'build', 'Release')
  const extraResourceNativeModules = fs.existsSync(extraResourceNativeDir)
    ? collectFiles(extraResourceNativeDir).filter((filePath) => filePath.endsWith('.node') || isMachOFile(filePath))
    : []
  assertNativeModuleArchitectures(appPath, extraResourceNativeModules)

  for (const codePath of nativeCodeObjects.sort((left, right) => left.localeCompare(right))) {
    verifyCodeSignature(codePath)
  }

  const signatureDetails = runCombined('/usr/bin/codesign', ['--display', '--verbose=4', mainExecutable])
  const cdHash = signatureDetails.split('\n').find((line) => line.includes('CDHash='))?.trim()
  console.log(`[verify-mac-signing] Verified ${nativeCodeObjects.length} native code object(s)`)
  if (cdHash) {
    console.log(`[verify-mac-signing] Main executable ${cdHash}`)
  }
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('[verify-mac-signing] Skipped: macOS codesign verification requires darwin')
    return
  }

  const releaseDir = path.resolve(process.argv[2] || path.join(ROOT_DIR, 'release'))
  const appBundles = findAppBundles(releaseDir)
  if (appBundles.length === 0) {
    throw new Error(`No .app bundles found under ${releaseDir}`)
  }

  for (const appPath of appBundles) {
    verifyAppBundle(appPath)
  }
}

main()
