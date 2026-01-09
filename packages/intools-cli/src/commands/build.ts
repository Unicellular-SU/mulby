import * as fs from 'fs-extra'
import * as path from 'path'
import * as esbuild from 'esbuild'
import chalk from 'chalk'

export async function build() {
  const cwd = process.cwd()
  const manifestPath = path.join(cwd, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    console.log(chalk.red('错误: 未找到 manifest.json'))
    process.exit(1)
  }

  console.log(chalk.blue('构建插件...'))

  // 读取 manifest
  const manifest = fs.readJsonSync(manifestPath)
  const entryPoint = path.join(cwd, 'src/main.ts')

  if (!fs.existsSync(entryPoint)) {
    console.log(chalk.red('错误: 未找到 src/main.ts'))
    process.exit(1)
  }

  // 确保 dist 目录存在
  fs.ensureDirSync(path.join(cwd, 'dist'))

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      outfile: path.join(cwd, 'dist/main.js'),
      minify: true
    })

    console.log(chalk.green('✓ 构建成功: dist/main.js'))
  } catch (err) {
    console.log(chalk.red('构建失败:'), err)
    process.exit(1)
  }
}
