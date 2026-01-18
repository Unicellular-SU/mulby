import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'
import { copyDefaultIcon } from './assets'
import { buildBasicMain, buildBasicManifest, buildBasicPackageJson } from './templates/basic'

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

  // 复制 API 参考文档
  const apiDocSrc = path.join(__dirname, '../../..', 'PLUGIN_API.md')
  if (fs.existsSync(apiDocSrc)) {
    fs.copyFileSync(apiDocSrc, path.join(targetDir, 'PLUGIN_API.md'))
    console.log(chalk.green('  ✓ PLUGIN_API.md'))
  }
}
