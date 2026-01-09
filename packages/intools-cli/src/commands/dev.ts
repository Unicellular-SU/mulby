import * as fs from 'fs-extra'
import * as path from 'path'
import * as esbuild from 'esbuild'
import chalk from 'chalk'

export async function dev() {
  const cwd = process.cwd()
  const manifestPath = path.join(cwd, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    console.log(chalk.red('错误: 未找到 manifest.json'))
    process.exit(1)
  }

  const entryPoint = path.join(cwd, 'src/main.ts')
  if (!fs.existsSync(entryPoint)) {
    console.log(chalk.red('错误: 未找到 src/main.ts'))
    process.exit(1)
  }

  fs.ensureDirSync(path.join(cwd, 'dist'))

  console.log(chalk.blue('启动开发模式...'))
  console.log(chalk.gray('监听文件变化中，按 Ctrl+C 退出'))
  console.log()

  const ctx = await esbuild.context({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    outfile: path.join(cwd, 'dist/main.js'),
    sourcemap: true
  })

  await ctx.watch()
  console.log(chalk.green('✓ 首次构建完成'))

  // 监听文件变化并输出日志
  const chokidar = await import('chokidar')
  const watcher = chokidar.watch(['src/**/*', 'manifest.json'], {
    cwd,
    ignoreInitial: true
  })

  watcher.on('change', (file) => {
    console.log(chalk.yellow(`文件变化: ${file}`))
  })

  // 保持进程运行
  process.on('SIGINT', async () => {
    console.log(chalk.blue('\n停止开发模式'))
    await ctx.dispose()
    watcher.close()
    process.exit(0)
  })
}
