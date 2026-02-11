import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'

function getAssetsDir(): string {
  return path.resolve(__dirname, '../../../assets')
}

export function copyDefaultIcon(targetDir: string) {
  const defaultIconPath = path.join(getAssetsDir(), 'default-icon.png')
  const targetIconPath = path.join(targetDir, 'icon.png')

  if (fs.existsSync(defaultIconPath)) {
    fs.copyFileSync(defaultIconPath, targetIconPath)
    console.log(chalk.green('  ✓ icon.png'))
  }
}
