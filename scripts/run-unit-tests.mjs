import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const ROOT_DIR = process.cwd()
const TEST_DIRS = [
  'src/renderer/__tests__',
  'src/main/ai/__tests__',
  'src/main/services/__tests__',
  'src/main/plugin/__tests__'
]

function collectTestFiles(dirPath) {
  const absoluteDir = join(ROOT_DIR, dirPath)
  const entries = readdirSync(absoluteDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = join(absoluteDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(relative(ROOT_DIR, absolutePath)))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.test.ts')) {
      continue
    }
    files.push(relative(ROOT_DIR, absolutePath))
  }

  return files
}

const testFiles = TEST_DIRS
  .filter((dirPath) => {
    try {
      return statSync(join(ROOT_DIR, dirPath)).isDirectory()
    } catch {
      return false
    }
  })
  .flatMap((dirPath) => collectTestFiles(dirPath))
  .sort((left, right) => left.localeCompare(right))

if (testFiles.length === 0) {
  console.error('No unit test files were found.')
  process.exit(1)
}

const child = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles],
  {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: 'inherit'
  }
)

if (child.error) {
  throw child.error
}

process.exit(child.status ?? 1)
