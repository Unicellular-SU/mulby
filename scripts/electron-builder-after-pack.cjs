const { execFileSync } = require('child_process')
const { existsSync, readdirSync, statSync, copyFileSync } = require('fs')
const path = require('path')

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function runText(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' })
}

function listSigningIdentities() {
  try {
    const output = runText('security', ['find-identity', '-v', '-p', 'codesigning'])
    const lines = output.split('\n')
    const parsed = []

    for (const line of lines) {
      const match = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"$/i)
      if (!match) continue
      parsed.push({
        hash: match[1],
        name: match[2]
      })
    }

    return parsed
  } catch {
    return []
  }
}

function identityPriority(name) {
  if (name.includes('Developer ID Application')) return 0
  if (name.includes('Apple Development')) return 1
  if (name.includes('Mac Developer')) return 2
  if (name.includes('iPhone Developer')) return 3
  return 9
}

function chooseIdentity(identities) {
  const preferred = (
    process.env.MULBY_LOCAL_SIGN_IDENTITY ||
    process.env.CSC_NAME ||
    ''
  ).trim()

  if (preferred) {
    const lowered = preferred.toLowerCase()
    const matched = identities.find((identity) =>
      identity.hash.toLowerCase() === lowered ||
      identity.name.toLowerCase() === lowered ||
      identity.name.toLowerCase().includes(lowered)
    )
    if (!matched) {
      throw new Error(`[afterPack] MULBY_LOCAL_SIGN_IDENTITY/CSC_NAME not found: ${preferred}`)
    }
    return matched
  }

  const sorted = [...identities].sort((a, b) => {
    const p = identityPriority(a.name) - identityPriority(b.name)
    if (p !== 0) return p
    const n = a.name.localeCompare(b.name)
    if (n !== 0) return n
    return a.hash.localeCompare(b.hash)
  })

  return sorted[0] || null
}

function listFilesRecursively(rootDir) {
  const result = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const entries = readdirSync(current)
    for (const entry of entries) {
      const fullPath = path.join(current, entry)
      const stats = statSync(fullPath)
      if (stats.isDirectory()) {
        stack.push(fullPath)
      } else if (stats.isFile()) {
        result.push(fullPath)
      }
    }
  }

  return result
}

function isMachOFile(filePath) {
  try {
    const output = execFileSync('file', ['-b', filePath], { encoding: 'utf8' })
    return output.includes('Mach-O')
  } catch {
    return false
  }
}

function signAdhoc(targetPath) {
  run('codesign', [
    '--force',
    '--sign',
    '-',
    '--timestamp=none',
    targetPath
  ])
}

function signWithIdentity(targetPath, identityHash) {
  run('codesign', [
    '--force',
    '--sign',
    identityHash,
    '--timestamp=none',
    targetPath
  ])
}

/**
 * 修复 sharp 在 Electron + asar.unpacked 环境下的 exports subpath 兼容问题。
 *
 * 历史背景：此修复最初为 Electron 28 添加。Electron 41 可能已修复此问题，
 * 但为安全起见保留此兼容代码。如果验证 Electron 41 的 exports 解析正常，
 * 可考虑移除此 hack。
 *
 * sharp.js 调用 require('@img/sharp-darwin-x64/sharp.node')，依赖 package.json exports map
 * 将 ./sharp.node 映射到 ./lib/sharp-darwin-x64.node。
 * 但 Electron 旧版本从 asar.unpacked 加载时无法正确解析 exports subpath，
 * 会直接在包根目录查找 sharp.node 文件。
 * 因此在包根目录额外复制一份命名为 sharp.node，让直接路径访问也可以工作。
 */
function fixSharpNativeBinaries(unpackedDir) {
  const imgDir = path.join(unpackedDir, 'node_modules', '@img')
  if (!existsSync(imgDir)) return

  const sharpPkgs = readdirSync(imgDir).filter((name) => name.startsWith('sharp-') && !name.startsWith('sharp-libvips'))
  let fixedCount = 0

  for (const pkgName of sharpPkgs) {
    const pkgDir = path.join(imgDir, pkgName)
    const libDir = path.join(pkgDir, 'lib')
    if (!existsSync(libDir)) continue

    // 找到 lib/ 下的 .node 文件（如 sharp-darwin-x64.node）
    const nodeFiles = readdirSync(libDir).filter((f) => f.endsWith('.node'))
    if (nodeFiles.length === 0) continue

    // 在包根目录创建 sharp.node，供 Electron 无法解析 exports subpath 时的直接路径访问
    const destPath = path.join(pkgDir, 'sharp.node')
    if (existsSync(destPath)) continue  // 已存在，跳过

    copyFileSync(path.join(libDir, nodeFiles[0]), destPath)
    fixedCount++
    console.log(`[afterPack] Copied ${pkgName}/lib/${nodeFiles[0]} -> ${pkgName}/sharp.node`)
  }

  if (fixedCount > 0) {
    console.log(`[afterPack] Fixed ${fixedCount} sharp native binary/binaries`)
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)

  if (!existsSync(appPath)) {
    throw new Error(`[afterPack] App not found: ${appPath}`)
  }

  const identities = listSigningIdentities()
  const selectedIdentity = chooseIdentity(identities)

  if (selectedIdentity) {
    console.log(`[afterPack] Using local signing identity: ${selectedIdentity.name} (${selectedIdentity.hash})`)
  } else {
    console.log(`[afterPack] No local signing identity found, fallback to ad-hoc signing ${appPath}`)
  }

  // 先签 app.asar.unpacked 下的 Mach-O 文件（例如 .node/native helper）
  const unpackedDir = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')

  // 修复 sharp exports subpath 兼容问题（详见 fixSharpNativeBinaries 注释）
  fixSharpNativeBinaries(unpackedDir)
  let signedNestedCount = 0
  if (existsSync(unpackedDir)) {
    const codeObjects = listFilesRecursively(unpackedDir).filter((filePath) => {
      if (filePath.endsWith('.dSYM')) return false
      if (filePath.endsWith('.map')) return false
      if (filePath.endsWith('.txt')) return false
      return filePath.endsWith('.node') || isMachOFile(filePath)
    })

    // 先签最深层文件，避免目录签名被后续文件签名破坏
    codeObjects
      .sort((a, b) => b.length - a.length)
      .forEach((codePath) => {
        if (selectedIdentity) {
          signWithIdentity(codePath, selectedIdentity.hash)
        } else {
          signAdhoc(codePath)
        }
        signedNestedCount += 1
      })
  }

  if (signedNestedCount > 0) {
    console.log(`[afterPack] Signed nested code objects: ${signedNestedCount}`)
  }

  const appSignArgs = [
    '--force',
    '--deep',
    '--timestamp=none',
    '--preserve-metadata=identifier,entitlements,requirements,flags,runtime'
  ]
  if (selectedIdentity) {
    appSignArgs.push('--sign', selectedIdentity.hash)
  } else {
    appSignArgs.push('--sign', '-')
  }
  appSignArgs.push(appPath)
  run('codesign', appSignArgs)

  run('codesign', [
    '--verify',
    '--deep',
    appPath
  ])

  console.log('[afterPack] Local signing completed')
}
