import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, '..')
const targetDir = resolve(packageRoot, 'dist/services/ai')

mkdirSync(targetDir, { recursive: true })

const legacyBaseCopyPath = resolve(targetDir, 'PLUGIN_DEVELOP_PROMPT.md')
if (existsSync(legacyBaseCopyPath)) {
  rmSync(legacyBaseCopyPath)
}

const assets = [
  { source: resolve(packageRoot, 'src/services/ai/PLUGIN_DEVELOP_AI_APPENDIX.md'), target: resolve(targetDir, 'PLUGIN_DEVELOP_AI_APPENDIX.md') }
]

for (const asset of assets) {
  if (!existsSync(asset.source)) continue
  cpSync(asset.source, asset.target)
}
