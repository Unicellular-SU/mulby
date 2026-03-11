import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, '..')
const sourceDir = resolve(packageRoot, 'src/services/ai')
const targetDir = resolve(packageRoot, 'dist/services/ai')

mkdirSync(targetDir, { recursive: true })

for (const assetName of ['PLUGIN_DEVELOP_PROMPT.md']) {
  const sourcePath = resolve(sourceDir, assetName)
  if (!existsSync(sourcePath)) continue
  cpSync(sourcePath, resolve(targetDir, assetName))
}
