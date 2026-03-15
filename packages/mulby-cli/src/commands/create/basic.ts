import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'
import { copyDefaultIcon } from './assets'
import {
  buildBasicMain,
  buildBasicManifest,
  buildBasicPackageJson,
  buildGitignore,
  buildBasicReadme
} from './templates/basic'

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

  const gitignore = buildGitignore()
  fs.writeFileSync(path.join(targetDir, '.gitignore'), gitignore)
  console.log(chalk.green('  ✓ .gitignore'))

  const readme = buildBasicReadme(name)
  fs.writeFileSync(path.join(targetDir, 'README.md'), readme)
  console.log(chalk.green('  ✓ README.md'))
}
