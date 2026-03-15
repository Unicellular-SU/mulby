import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, '..')
const targetDir = resolve(packageRoot, 'dist/services/ai')
const bundledSkillsTargetDir = resolve(targetDir, 'bundled-skills')

mkdirSync(targetDir, { recursive: true })
rmSync(bundledSkillsTargetDir, { recursive: true, force: true })
mkdirSync(bundledSkillsTargetDir, { recursive: true })

// Remove the legacy copied prompt artifact from older builds.
const legacyPromptArtifactPath = resolve(targetDir, 'PLUGIN_DEVELOP_PROMPT.md')
if (existsSync(legacyPromptArtifactPath)) {
  rmSync(legacyPromptArtifactPath)
}

const assets = [
  { source: resolve(packageRoot, 'src/services/ai/PLUGIN_DEVELOP_AI_APPENDIX.md'), target: resolve(targetDir, 'PLUGIN_DEVELOP_AI_APPENDIX.md') }
]

for (const asset of assets) {
  if (!existsSync(asset.source)) continue
  cpSync(asset.source, asset.target)
}

const bundledSkills = [
  {
    source: resolve(packageRoot, '..', '..', 'skills', 'develop-mulby-plugin'),
    target: resolve(bundledSkillsTargetDir, 'develop-mulby-plugin')
  },
  {
    source: resolve(packageRoot, '..', '..', 'skills', 'generate-electron-icons'),
    target: resolve(bundledSkillsTargetDir, 'generate-electron-icons')
  }
]

for (const bundledSkill of bundledSkills) {
  if (!existsSync(bundledSkill.source)) continue
  cpSync(bundledSkill.source, bundledSkill.target, { recursive: true })
}
