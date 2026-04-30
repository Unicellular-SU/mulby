const { existsSync, readdirSync, rmSync } = require('fs')
const path = require('path')

function removeIfExists(targetPath) {
  if (!existsSync(targetPath)) return
  rmSync(targetPath, { recursive: true, force: true })
  console.log(`[beforeBuild] Removed unsupported Windows dependency: ${targetPath}`)
}

function removeWindowsUnsupportedNativeDeps(appDir) {
  const nodeModulesDir = path.join(appDir, 'node_modules')
  const pnpmDir = path.join(nodeModulesDir, '.pnpm')

  removeIfExists(path.join(nodeModulesDir, 'usocket'))

  if (!existsSync(pnpmDir)) return

  for (const entry of readdirSync(pnpmDir)) {
    if (entry.startsWith('usocket@')) {
      removeIfExists(path.join(pnpmDir, entry))
      continue
    }

    if (entry.startsWith('dbus-next@')) {
      removeIfExists(path.join(pnpmDir, entry, 'node_modules', 'usocket'))
    }
  }
}

module.exports = async function beforeBuild(context) {
  if (context.platform?.nodeName !== 'win32') {
    return true
  }

  removeWindowsUnsupportedNativeDeps(context.appDir)
  return true
}
