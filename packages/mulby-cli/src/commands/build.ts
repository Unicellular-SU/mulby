import * as fs from 'fs-extra'
import * as path from 'path'
import * as esbuild from 'esbuild'
import chalk from 'chalk'
import { spawn } from 'child_process'

export async function build() {
  const cwd = process.cwd()
  const manifestPath = path.join(cwd, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    console.log(chalk.red('错误: 未找到 manifest.json'))
    process.exit(1)
  }

  const manifest = fs.readJsonSync(manifestPath)
  const hasUI = !!manifest.ui

  console.log(chalk.blue('构建插件...'))
  console.log()

  // 1. 构建后端
  await buildBackend(cwd)

  // 2. 构建 UI（如果有）
  if (hasUI) {
    await buildUI(cwd)
  }

  console.log()
  console.log(chalk.green('✓ 构建完成'))
}

async function buildBackend(cwd: string) {
  const entryPoint = path.join(cwd, 'src/main.ts')

  if (!fs.existsSync(entryPoint)) {
    console.log(chalk.yellow('跳过后端构建: 未找到 src/main.ts'))
    return
  }

  fs.ensureDirSync(path.join(cwd, 'dist'))

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      external: ['electron'], // 这里很重要，防止宿主环境依赖被打进主进程
      treeShaking: true,      // 确保摇树优化开启
      outfile: path.join(cwd, 'dist/main.js'),
      minify: true
    })
    console.log(chalk.green('  ✓ 后端构建: dist/main.js'))
  } catch (err) {
    console.log(chalk.red('后端构建失败:'), err)
    process.exit(1)
  }
}

async function buildUI(cwd: string) {
  const viteConfig = path.join(cwd, 'vite.config.ts')

  if (!fs.existsSync(viteConfig)) {
    console.log(chalk.yellow('跳过 UI 构建: 未找到 vite.config.ts'))
    return
  }

  console.log(chalk.blue('  构建 UI...'))

  return new Promise<void>((resolve, reject) => {
    const vite = spawn('npx', ['vite', 'build'], {
      cwd,
      stdio: 'inherit',
      shell: true
    })

    vite.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('  ✓ UI 构建: ui/'))
        resolve()
      } else {
        reject(new Error(`Vite 构建失败，退出码: ${code}`))
      }
    })

    vite.on('error', reject)
  })
}
