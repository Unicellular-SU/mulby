import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'
import { copyDefaultIcon } from './assets'
import { buildBasicMain, buildBasicManifest, buildBasicPackageJson, buildGitignore, buildBasicReadme } from './templates/basic'

export async function createBasicProject(targetDir: string, name: string) {
  fs.mkdirSync(targetDir, { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'src'))

  copyDefaultIcon(targetDir)

  const manifest = buildBasicManifest(name)
  fs.writeJsonSync(path.join(targetDir, 'manifest.json'), manifest, { spaces: 2 })
  console.log(chalk.green('  ✓ manifest.json'))

  const pkg = buildBasicPackageJson(name)
  fs.writeJsonSync(path.join(targetDir, 'package.json'), pkg, { spaces: 2 })
  console.log(chalk.green('  ✓ package.json'))

  const mainTs = buildBasicMain(name)
  fs.writeFileSync(path.join(targetDir, 'src/main.ts'), mainTs)
  console.log(chalk.green('  ✓ src/main.ts'))

  // 创建 .gitignore
  const gitignore = buildGitignore()
  fs.writeFileSync(path.join(targetDir, '.gitignore'), gitignore)
  console.log(chalk.green('  ✓ .gitignore'))

  // 创建 README.md
  const readme = buildBasicReadme(name)
  fs.writeFileSync(path.join(targetDir, 'README.md'), readme)
  console.log(chalk.green('  ✓ README.md'))

  // 复制 API 参考文档
  const apiDocSrc = path.join(__dirname, '../../..', 'PLUGIN_DEVELOP_PROMPT.md')
  if (fs.existsSync(apiDocSrc)) {
    fs.copyFileSync(apiDocSrc, path.join(targetDir, 'PLUGIN_DEVELOP_PROMPT.md'))
    console.log(chalk.green('  ✓ PLUGIN_DEVELOP_PROMPT.md'))
  }
}
