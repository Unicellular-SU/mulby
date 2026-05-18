import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const rootDir = process.cwd()
const nativeDir = join(rootDir, 'native')
const textSelectionDir = join(nativeDir, 'win32-text-selection')
const electronPackagePath = join(rootDir, 'node_modules', 'electron', 'package.json')
const addonFileNames = [
  'clipboard_watcher.node',
  'finder_selection.node',
  'input_monitor.node',
  'screen_capture.node',
  'window_watcher.node'
]

function run(command, args, cwd, env = {}) {
  console.log(`[build-native] ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env
    }
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
const addonOutputDir = join(nativeDir, 'build', 'Release')

function buildNativeAddons(args = [], env = {}) {
  run(process.execPath, [
    nodeGypBin,
    'rebuild',
    `--target=${electronVersion}`,
    '--dist-url=https://electronjs.org/headers',
    ...args
  ], nativeDir, env)

  for (const fileName of addonFileNames) {
    assertExists(join(addonOutputDir, fileName))
  }
}

function buildDarwinUniversalAddons() {
  const tempDir = join(tmpdir(), `mulby-native-universal-${process.pid}`)
  rmSync(tempDir, { recursive: true, force: true })

  try {
    for (const arch of ['x64', 'arm64']) {
      buildNativeAddons([`--arch=${arch}`], {
        npm_config_arch: arch
      })

      const archDir = join(tempDir, arch)
      mkdirSync(archDir, { recursive: true })
      for (const fileName of addonFileNames) {
        cpSync(join(addonOutputDir, fileName), join(archDir, fileName))
      }
    }

    for (const fileName of addonFileNames) {
      const outputPath = join(addonOutputDir, fileName)
      run('lipo', [
        '-create',
        join(tempDir, 'x64', fileName),
        join(tempDir, 'arm64', fileName),
        '-output',
        outputPath
      ], rootDir)
      run('lipo', ['-info', outputPath], rootDir)
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

if (process.platform === 'darwin') {
  buildDarwinUniversalAddons()
} else {
  buildNativeAddons()
}

if (process.platform === 'win32') {
  const buildDir = join(textSelectionDir, 'build')
  run('cmake', ['-S', textSelectionDir, '-B', buildDir], rootDir)
  run('cmake', ['--build', buildDir, '--config', 'Release'], rootDir)
  assertExists(join(buildDir, 'Release', 'text_selection.dll'))
}

console.log('[build-native] Native artifacts are ready.')
