import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const rootDir = process.cwd()
const nativeDir = join(rootDir, 'native')
const textSelectionDir = join(nativeDir, 'win32-text-selection')
const electronPackagePath = join(rootDir, 'node_modules', 'electron', 'package.json')

function run(command, args, cwd) {
  console.log(`[build-native] ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env
  })
}

function readElectronVersion() {
  const pkg = JSON.parse(readFileSync(electronPackagePath, 'utf8'))
  if (!pkg.version) {
    throw new Error('[build-native] Unable to resolve Electron version')
  }
  return pkg.version
}

function assertExists(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`[build-native] Missing required native artifact: ${filePath}`)
  }
}

const electronVersion = readElectronVersion()
const nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js')

run(process.execPath, [
  nodeGypBin,
  'rebuild',
  `--target=${electronVersion}`,
  '--dist-url=https://electronjs.org/headers'
], nativeDir)

const addonOutputDir = join(nativeDir, 'build', 'Release')
for (const fileName of [
  'clipboard_watcher.node',
  'finder_selection.node',
  'screen_capture.node',
  'window_watcher.node'
]) {
  assertExists(join(addonOutputDir, fileName))
}

if (process.platform === 'win32') {
  const buildDir = join(textSelectionDir, 'build')
  run('cmake', ['-S', textSelectionDir, '-B', buildDir], rootDir)
  run('cmake', ['--build', buildDir, '--config', 'Release'], rootDir)
  assertExists(join(buildDir, 'Release', 'text_selection.dll'))
}

console.log('[build-native] Native artifacts are ready.')
