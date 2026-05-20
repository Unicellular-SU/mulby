#!/usr/bin/env node

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

process.noAsar = true

const UPDATABLE_ROOTS = [
  'app.asar',
  'app.asar.unpacked',
  'internal-plugins',
  'mcp',
  'native/build/Release',
  'resources/tray',
  'bin',
  'updater'
]

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    if (key === '--skip-wait') {
      args.skipWait = true
      continue
    }
    if (key === '--no-relaunch') {
      args.noRelaunch = true
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`)
    }
    args[key.slice(2)] = value
    i += 1
  }
  return args
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function appendLog(logFile, message) {
  ensureDir(path.dirname(logFile))
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
}

function copyPath(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath))
  const stats = fs.statSync(sourcePath)
  if (stats.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
      preserveTimestamps: true,
      force: true,
      errorOnExist: false
    })
    return
  }
  fs.copyFileSync(sourcePath, targetPath)
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true })
}

function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessExit(pid, timeoutMs, logFile) {
  if (!pid || pid <= 0) return
  const startedAt = Date.now()
  while (isProcessAlive(pid)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for main process ${pid} to exit`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  appendLog(logFile, `Main process ${pid} exited`)
}

function collectRelativeEntries(rootDir) {
  const result = []
  const stack = ['']
  while (stack.length > 0) {
    const relativeDir = stack.pop()
    const absoluteDir = path.join(rootDir, relativeDir)
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = path.join(relativeDir, entry.name)
      if (entry.isDirectory()) {
        result.push(relativePath)
        stack.push(relativePath)
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        result.push(relativePath)
      }
    }
  }
  return result
}

function isAllowedStagedPath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/')
  if (!normalized || normalized === '.DS_Store' || normalized.startsWith('__MACOSX/')) {
    return true
  }
  return UPDATABLE_ROOTS.some((root) => (
    normalized === root ||
    normalized.startsWith(`${root}/`) ||
    root.startsWith(`${normalized}/`)
  ))
}

function validateStaging(stagingDir) {
  const entries = collectRelativeEntries(stagingDir)
  for (const relativePath of entries) {
    if (!isAllowedStagedPath(relativePath)) {
      throw new Error(`Update package contains unsupported resource path: ${relativePath}`)
    }
  }
  const stagedRoots = UPDATABLE_ROOTS.filter((root) => fs.existsSync(path.join(stagingDir, root)))
  if (stagedRoots.length === 0) {
    throw new Error('Update package does not contain any updatable resources')
  }
  if (!fs.existsSync(path.join(stagingDir, 'app.asar'))) {
    throw new Error('Update package is missing app.asar')
  }
  return stagedRoots
}

function adhocSignUpdatedBundle(resourcesDir, stagedRoots, logFile) {
  const dirsToSign = []

  if (stagedRoots.includes('native/build/Release')) {
    const nativeDir = path.join(resourcesDir, 'native/build/Release')
    if (fs.existsSync(nativeDir)) dirsToSign.push(nativeDir)
  }

  if (stagedRoots.includes('app.asar.unpacked')) {
    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')
    if (fs.existsSync(unpackedDir)) dirsToSign.push(unpackedDir)
  }

  if (dirsToSign.length === 0) return

  let signedCount = 0
  for (const dir of dirsToSign) {
    const entries = collectRelativeEntries(dir)
    for (const entry of entries) {
      if (!entry.endsWith('.node') && !entry.endsWith('.dylib')) continue
      const filePath = path.join(dir, entry)
      try {
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) continue
        execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', filePath], { stdio: 'pipe' })
        signedCount += 1
      } catch (err) {
        appendLog(logFile, `Warning: failed to sign ${entry}: ${err.message}`)
      }
    }
  }

  if (signedCount > 0) {
    appendLog(logFile, `Ad-hoc signed ${signedCount} native module(s)`)
  }

  // NOTE: Do NOT re-sign the .app bundle here.
  // Re-signing with --deep changes the main executable's CDHash, which invalidates
  // the TCC (Transparency, Consent, and Control) accessibility permission grant.
  // macOS does not enforce sealed resource validation at runtime for ad-hoc signed apps;
  // it only matters at Gatekeeper first-launch. Individual .node files are signed above
  // so that dlopen() can load them.
}

function applyResources({ stagingDir, resourcesDir, backupDir, stagedRoots, logFile }) {
  const changedRoots = []

  try {
    for (const root of stagedRoots) {
      const sourcePath = path.join(stagingDir, root)
      const targetPath = path.join(resourcesDir, root)
      const backupPath = path.join(backupDir, root)
      const targetExists = fs.existsSync(targetPath)

      if (targetExists) {
        appendLog(logFile, `Backing up ${root}`)
        copyPath(targetPath, backupPath)
      }

      appendLog(logFile, `Replacing ${root}`)
      removePath(targetPath)
      copyPath(sourcePath, targetPath)
      changedRoots.push({ root, targetPath, backupPath, targetExists })
    }
  } catch (error) {
    appendLog(logFile, `Apply failed, rolling back: ${error instanceof Error ? error.message : String(error)}`)
    for (const item of changedRoots.reverse()) {
      removePath(item.targetPath)
      if (item.targetExists && fs.existsSync(item.backupPath)) {
        copyPath(item.backupPath, item.targetPath)
      }
    }
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const packagePath = path.resolve(String(args.package || ''))
  const appPath = path.resolve(String(args.app || ''))
  const version = String(args.version || 'unknown')
  const pid = Number(args.pid || 0)
  const userData = path.resolve(String(args['user-data'] || path.join(os.homedir(), 'Library', 'Application Support', 'Mulby')))
  const logFile = path.join(userData, 'logs', 'update-helper.log')

  appendLog(logFile, `Starting resource update version=${version} package=${packagePath} app=${appPath}`)

  if (!packagePath || !fs.existsSync(packagePath)) {
    throw new Error(`Update package not found: ${packagePath}`)
  }
  if (!appPath.endsWith('.app') || !fs.existsSync(appPath)) {
    throw new Error(`Mulby.app not found: ${appPath}`)
  }

  if (!args.skipWait) {
    await waitForProcessExit(pid, 60000, logFile)
  }

  const resourcesDir = path.join(appPath, 'Contents', 'Resources')
  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`Resources directory not found: ${resourcesDir}`)
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mulby-resource-update-'))
  const backupDir = path.join(resourcesDir, '.mulby-update-backup', `${version}-${Date.now()}`)

  try {
    appendLog(logFile, `Extracting update package to ${stagingDir}`)
    execFileSync('/usr/bin/ditto', ['-x', '-k', packagePath, stagingDir], { stdio: 'pipe' })

    const stagedRoots = validateStaging(stagingDir)
    ensureDir(backupDir)
    applyResources({ stagingDir, resourcesDir, backupDir, stagedRoots, logFile })
    adhocSignUpdatedBundle(resourcesDir, stagedRoots, logFile)

    appendLog(logFile, `Resource update applied; backup=${backupDir}`)
    if (!args.noRelaunch) {
      execFileSync('/usr/bin/open', ['-n', appPath], { stdio: 'ignore' })
      appendLog(logFile, `Relaunched ${appPath}`)
    }
  } finally {
    removePath(stagingDir)
  }
}

main().catch((error) => {
  const fallbackLog = path.join(os.homedir(), 'Library', 'Application Support', 'Mulby', 'logs', 'update-helper.log')
  try {
    appendLog(fallbackLog, `Resource update failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
  } catch {
    // Ignore logging failures during process teardown.
  }
  process.exitCode = 1
})
