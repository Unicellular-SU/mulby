import * as fs from 'fs-extra'
import * as path from 'path'
import * as esbuild from 'esbuild'
import chalk from 'chalk'
import { spawn, ChildProcess } from 'child_process'

let viteProcess: ChildProcess | null = null

export async function dev() {
  const cwd = process.cwd()
  const manifestPath = path.join(cwd, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    console.log(chalk.red('错误: 未找到 manifest.json'))
    process.exit(1)
  }

  const manifest = fs.readJsonSync(manifestPath)
  const hasUI = !!manifest.ui
  const entryPoint = path.join(cwd, 'src/main.ts')

  console.log(chalk.blue('启动开发模式...'))
  console.log()

  // 确保 dist 目录存在
  fs.ensureDirSync(path.join(cwd, 'dist'))

  // 1. 启动后端监听
  if (fs.existsSync(entryPoint)) {
    await startBackendWatch(cwd, entryPoint)
  }

  // 2. 启动 UI 开发服务器（如果有）
  if (hasUI) {
    await startViteDevServer(cwd)
  }

  console.log()
  console.log(chalk.gray('按 Ctrl+C 退出'))

  // 处理退出
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

async function startBackendWatch(cwd: string, entryPoint: string) {
  const ctx = await esbuild.context({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    outfile: path.join(cwd, 'dist/main.js'),
    sourcemap: true
  })

  await ctx.watch()
  console.log(chalk.green('✓ 后端监听已启动'))

  // 监听文件变化并输出日志
  const chokidar = await import('chokidar')
  const watcher = chokidar.watch(['src/main.ts', 'src/**/*.ts'], {
    cwd,
    ignoreInitial: true,
    ignored: ['src/ui/**']
  })

  watcher.on('change', (file) => {
    console.log(chalk.yellow(`[后端] 文件变化: ${file}`))
  })
}

async function startViteDevServer(cwd: string) {
  const viteConfig = path.join(cwd, 'vite.config.ts')

  if (!fs.existsSync(viteConfig)) {
    console.log(chalk.yellow('跳过 UI 开发服务器: 未找到 vite.config.ts'))
    return
  }

  // 每次启动开发模式都构建 UI
  // 这样应用可以加载最新的插件 UI
  console.log(chalk.blue('构建 UI...'))
  await new Promise<void>((resolve, reject) => {
    const viteBuild = spawn('npx', ['vite', 'build'], {
      cwd,
      stdio: 'inherit',
      shell: true
    })

    viteBuild.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('✓ UI 构建完成: ui/'))
        resolve()
      } else {
        reject(new Error(`Vite 构建失败，退出码: ${code}`))
      }
    })

    viteBuild.on('error', reject)
  })

  console.log()
  console.log(chalk.blue('启动 Vite 开发服务器...'))
  console.log(chalk.gray('  💡 提示: Vite 开发服务器提供 UI 预览，修改 UI 代码后'))
  console.log(chalk.gray('           在 InTools 中点击「刷新插件」或执行 npm run build 更新'))
  console.log()

  viteProcess = spawn('npx', ['vite', '--host'], {
    cwd,
    stdio: 'inherit',
    shell: true
  })

  viteProcess.on('error', (err) => {
    console.log(chalk.red('Vite 启动失败:'), err)
  })
}

function cleanup() {
  console.log(chalk.blue('\n停止开发模式...'))

  if (viteProcess) {
    viteProcess.kill()
  }

  process.exit(0)
}
